/* ====================================================================
   GAME HUB CLIENT
   Architecture mirrors the server:
     • Hub shell  : menu, room lobby, matchmaking, networking.
     • Card Kit   : shared visuals/anim/sound (window.Kit) — all games reuse it.
     • Game module: window.GameClients[id] renders that game's view & input.
   Adding a game on the client = add one entry to GameClients with the same
   shape as Skyjo below. The hub never needs to change.
   ==================================================================== */
const PARTYKIT_HOST = location.host; // served by the same Worker
const BUILD_VERSION = "v70-proposals-p3-p5-p10-skyjo-determinism"; // bump on each change; shown on the menu

const $=id=>document.getElementById(id);
function esc(v){return String(v ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
window.GameRules = window.GameRules || {};
function showScreen(id){
  // Leaving the game screen? Tear down any body-level game widgets (Flip 7 controls/dealer)
  // so Hit/Stay etc. can never linger over a menu.
  if(id!=='gameScreen'){if(typeof GameShell!=='undefined')GameShell.unmount();else{const f7=$('f7Controls');if(f7)f7.remove();const dw=$('f7DealerWrap');if(dw)dw.remove();}}
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');
  if(id==='joinSetup')connectLobby();
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function toast(m,ms=2600){const t=$('toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.add('hidden'),ms);}
function getPid(){let p=localStorage.getItem('hub_pid');if(!p){p='p_'+Math.random().toString(36).slice(2,10)+Date.now().toString(36);localStorage.setItem('hub_pid',p);}return p;}
const GameActions={
  send(action,extra={},seat=null){
    const resolvedSeat=seat ?? window._renderView?.yourSeat ?? 0;
    const msg={action,...extra};
    if(mode==='local'){ if(typeof localAct==='function') localAct(resolvedSeat,msg); }
    else if(typeof net!=='undefined'){ net.send({type:'action',seat:resolvedSeat,...msg}); }
  },
  // Convenience used by game clients' internal animation code, which carries a
  // whole {action,...} message + an explicit seat. Was reimplemented per-game
  // (split out the action key, re-send) — now shared (L4 de-dup).
  act(seat,msg={}){ const {action,...extra}=msg; this.send(action,extra,seat); }
};

/* ====================== CARD KIT (shared) ====================== */
const Kit=(()=>{
  // ── Card animation: ONE system — Kit.CardManager ─────────────────────────
  // All card movement/animation goes through CardManager. The legacy layers
  // (flyCard / CardMotion / Card / CardEffects / flyToHeld) were removed; their
  // capabilities now live as CardManager methods that all share the same clean,
  // uniform transform:scale flight:
  //   • moveTo(id, toAnchor, opts)   — move a PERMANENT card (stable id + one
  //       location; the overlay IS the card) between real slots.
  //   • flyTransient(fromEl, toEl, opts) — a one-off fly of an ad-hoc element
  //       (no permanent identity), e.g. Flip 7 action-card transfers, Skyjo
  //       swap→discard. Builds on moveTo and self-destroys on arrival.
  //   • triplet({cards, discardEl, ...}) — composite clear effect (tilt-stack +
  //       fly to discard).
  //   • revealEl(el, value, opts) — in-place flip/reveal of any DOM element.
  //   • flip(id, faceUp) / pin / unpin / sync / reconcile / clear / etc.
  // ─────────────────────────────────────────────────────────────────────────
  function cardColor(v){if(v<0)return'#4338ca';if(v===0)return'#0ea5e9';if(v<=4)return'#22c55e';if(v<=8)return'#eab308';return'#ef4444';}
  function floatText(boardEl,text,color){
    // Card overlays are position:fixed at the body level (z-index up to 1000), so
    // popup text must also be fixed at the body level ABOVE them to never render
    // behind a card. Position it over the given board element's center.
    const f=document.createElement('div');f.className='floating-text floating-text-fixed';f.style.color=color;f.textContent=text;
    const r=boardEl?boardEl.getBoundingClientRect():{left:innerWidth/2-60,top:innerHeight*0.4,width:120,height:0};
    f.style.left=(r.left+r.width/2)+'px';f.style.top=(r.top+Math.max(0,r.height*0.35))+'px';
    document.body.appendChild(f);setTimeout(()=>f.remove(),1500);
  }
  function turnBanner(text,mine){const b=document.createElement('div');b.className='turn-banner';b.textContent=text;b.style.color=mine?'#10b981':'#60a5fa';document.body.appendChild(b);setTimeout(()=>b.remove(),1700);}
  function dealCascade(){
    // Intro deal cascade. Board cards are now framework anchors (empty .kc
    // placeholders) whose VISIBLE pixels live in a CardManager overlay pinned on
    // top — so animating the anchor animates nothing the player can see. Resolve
    // each anchor to its overlay (matched by id: anchor[data-card-reg] ↔
    // overlay[data-cm-id]) and cascade THAT; fall back to the anchor itself for
    // any non-overlay (legacy) board card. This is why the intro animation had
    // silently stopped after the overlay migration.
    const anchors=document.querySelectorAll('#mainBoardsContainer .board-card, #miniBoardsContainer .board-card');
    const targets=[];
    // Build an id→overlay map once (ids can contain ':' etc.; avoid per-id
    // selector escaping by indexing the registered overlays directly).
    const ovById=new Map();
    document.querySelectorAll('.kit-card-registered[data-cm-id]').forEach(o=>ovById.set(o.dataset.cmId,o));
    anchors.forEach(a=>{
      const id=a.dataset.cardReg;
      const overlay=id?ovById.get(id):null;
      targets.push(overlay||a);
    });
    // De-dupe (in case an anchor and its overlay both somehow matched).
    const seen=new Set();
    const cards=targets.filter(el=>el&&!seen.has(el)&&seen.add(el));
    cards.forEach((c,i)=>{
      c.classList.remove('anim-deal');void c.offsetWidth;
      c.style.animationDelay=(i%12)*0.035+'s';
      c.classList.add('anim-deal');
      if(i%4===0)setTimeout(()=>SFX.deal(),(i%12)*35);
      setTimeout(()=>{c.style.animationDelay='';c.classList.remove('anim-deal');},700+(i%12)*40);
    });
  }
  const EventRunner=(()=>{
    let chain=Promise.resolve();
    function run(events,handler){
      chain=chain.then(async()=>{for(const ev of events)await handler(ev);});
      return chain;
    }
    function idle(){return chain;}
    return {run,idle};
  })();
  function rollDice(container,dice,{duration=900,size=42,animate=true,originEl=null}={}){
    return new Promise(res=>{
      if(!container){res();return;}
      const colorCls={white:'white',red:'red',yellow:'yellow',green:'green',blue:'blue',r:'red',y:'yellow',g:'green',b:'blue'};
      const makeDie=(d)=>`<div class="kit-die ${colorCls[d.color]||d.color||'white'}"><b class="face front"><span>${d.value}</span></b><b class="face back"></b><b class="face right"></b><b class="face left"></b><b class="face top"></b><b class="face bottom"></b></div>`;
      if(!animate||window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        container.classList.remove('rolling');
        container.innerHTML=dice.map(d=>`<div class="kit-die-static" style="--die-size:${size}px">${makeDie(d)}</div>`).join('');
        res();return;
      }
      const w=Math.max(container.clientWidth||280,size*dice.length+12),h=Math.max(container.clientHeight||64,size+18);
      container.classList.add('rolling');
      container.innerHTML='';
      const cr=container.getBoundingClientRect();
      const or=originEl?originEl.getBoundingClientRect():null;
      const ox=or?Math.max(0,Math.min(w-size,or.left+or.width/2-cr.left-size/2)):null;
      const oy=or?Math.max(0,Math.min(h-size,or.top+or.height/2-cr.top-size/2)):null;
      const bodies=dice.map((d,i)=>{
        const el=document.createElement('div');
        el.className='kit-die-phys';el.style.setProperty('--die-size',size+'px');el.innerHTML=makeDie({...d,value:'•'});container.appendChild(el);
        const targetX=8+i*(size+6);
        return {d,el,x:ox??targetX,y:oy??(2+Math.random()*8),vx:(targetX-(ox??targetX))*0.06+(Math.random()*2-1)*7,vy:-(7+Math.random()*6),r:Math.random()*360,vr:(Math.random()*2-1)*32,lastFace:0};
      });
      const start=performance.now();
      function step(now){
        const t=now-start,dt=1;
        for(const b of bodies){
          b.vy+=0.42*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;b.r+=b.vr*dt;
          if(b.x<0){b.x=0;b.vx=Math.abs(b.vx)*0.72;b.vr*=-0.7;}
          if(b.x>w-size){b.x=w-size;b.vx=-Math.abs(b.vx)*0.72;b.vr*=-0.7;}
          if(b.y<0){b.y=0;b.vy=Math.abs(b.vy)*0.58;}
          if(b.y>h-size){b.y=h-size;b.vy=-Math.abs(b.vy)*0.62;b.vx*=0.86;b.vr*=0.76;}
          b.vx*=0.992;b.vy*=0.992;
          if(t<duration-170 && now-b.lastFace>70){b.lastFace=now;const sp=b.el.querySelector('span');if(sp)sp.textContent=String(1+Math.floor(Math.random()*6));}
          b.el.style.transform=`translate(${b.x}px,${b.y}px) rotateX(${b.r*1.3}deg) rotateY(${b.r*.9}deg) rotateZ(${b.r}deg)`;
        }
        if(t<duration) requestAnimationFrame(step);
        else{
          bodies.forEach((b,i)=>{const sp=b.el.querySelector('span');if(sp)sp.textContent=b.d.value;b.el.style.transition='transform .22s cubic-bezier(.2,1.4,.3,1)';b.el.style.transform=`translate(${8+i*(size+6)}px,${Math.max(0,(h-size)/2)}px) rotateX(0) rotateY(0) rotateZ(0)`;});
          setTimeout(()=>{container.classList.remove('rolling');res();},240);
        }
      }
      requestAnimationFrame(step);
    });
  }
  function confetti(){
    const cv=document.createElement('canvas');cv.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:500';cv.width=innerWidth;cv.height=innerHeight;document.body.appendChild(cv);
    const x=cv.getContext('2d'),cols=['#3b82f6','#10b981','#eab308','#ef4444','#8b5cf6','#0ea5e9','#f59e0b'],ps=[];
    const burst=ox=>{for(let i=0;i<90;i++){const an=(ox<0.5?-0.35:Math.PI+0.35)+(Math.random()-0.5)*1.1,sp=8+Math.random()*9;ps.push({x:ox*cv.width,y:cv.height*0.72,vx:Math.cos(an)*sp,vy:Math.sin(an)*sp-6,r:4+Math.random()*6,c:cols[(Math.random()*cols.length)|0],a:Math.random()*Math.PI,va:(Math.random()-0.5)*0.4});}};
    burst(0.08);burst(0.92);setTimeout(()=>{burst(0.2);burst(0.8);},350);const end=Date.now()+3800;
    (function f(){x.clearRect(0,0,cv.width,cv.height);for(const p of ps){p.vy+=0.28;p.vx*=0.99;p.x+=p.vx;p.y+=p.vy;p.a+=p.va;x.save();x.translate(p.x,p.y);x.rotate(p.a);x.fillStyle=p.c;x.fillRect(-p.r/2,-p.r/2,p.r,p.r*0.6);x.restore();}if(Date.now()<end)requestAnimationFrame(f);else cv.remove();})();
  }

  // ────────────────────────────────────────────────────────────────
  // CardManager — Permanent Card System
  //
  // A card is a FIRST-CLASS OBJECT with a stable ID, exactly one
  // location at all times. This structurally eliminates:
  //   ❌ "Card in two places" bugs   (single-location invariant)
  //   ❌ "Card vanishes during anim" (card always has a position)
  //   ❌ Render-before-animate      (manager drives rendering)
  //   ❌ Manual sync/reconcile      (manager tracks its own anchors)
  // ────────────────────────────────────────────────────────────────
  const CardManager=(()=>{
    const cards=new Map();
    let _nextId=0;
    function nodeFromHTML(html){const t=document.createElement('template');t.innerHTML=String(html||'').trim();return t.content.firstElementChild;}

    function stableRect(anchor){
      if(!anchor)return null;
      const r=anchor.getBoundingClientRect();
      let el=anchor.parentElement;
      while(el&&el!==document.body){
        const cs=getComputedStyle(el),t=cs.transform;
        if(t&&t!=='none'){
          const pr=el.getBoundingClientRect(),pw=el.offsetWidth,ph=el.offsetHeight;
          if(pw>0&&Math.abs(pr.width/pw-1)>0.01){
            const sx=pr.width/pw,sy=pr.height/ph;
            const pcx=pr.left+pr.width/2,pcy=pr.top+pr.height/2;
            const dx=r.left-pcx,dy=r.top-pcy;
            return {top:pcy+dy/sy,left:pcx+dx/sx,width:r.width/sx,height:r.height/sy,right:pcx+dx/sx+r.width/sx,bottom:pcy+dy/sy+r.height/sy};
          }
        }
        el=el.parentElement;
      }
      return r;
    }

    // Card height/width ratio from the canonical --kc-aspect ("W / H"). Returns
    // H/W (≈1.4 for 5/7). Cached fallback keeps a card card-shaped even if the var
    // can't be read (so the fly API never produces a stretched "pill").
    let _kcAspectH=7/5;
    function readCardAspectH(el){
      try{
        const v=getComputedStyle(el).getPropertyValue('--kc-aspect').trim();
        const m=v && v.match(/([\d.]+)\s*\/\s*([\d.]+)/);
        if(m){const w=parseFloat(m[1]),h=parseFloat(m[2]); if(w>0&&h>0){_kcAspectH=h/w; return _kcAspectH;}}
      }catch(_){}
      return _kcAspectH;
    }
    function positionOverlay(overlayEl,anchor){
      if(!overlayEl||!anchor)return;
      const r=stableRect(anchor);if(!r)return;
      const cs=getComputedStyle(anchor);
      Object.assign(overlayEl.style,{position:'fixed',top:r.top+'px',left:r.left+'px',width:r.width+'px',height:r.height+'px',opacity:'1',pointerEvents:'none',boxSizing:'border-box'});
      // Framework cards (.kc): drive ALL geometry from the measured width so corners,
      // border, font and pips stay proportional at ANY size (mini → focus). We set
      // --kc-w to the rendered width; the proportional CSS (border-radius/font =
      // calc(--kc-w*…)) does the rest. Do NOT copy a fixed radius or clamp the font.
      if(overlayEl.classList.contains('kc')){
        overlayEl.style.setProperty('--kc-w', r.width+'px');
        // Aspect-LOCK: a card must always stay card-shaped. If the anchor was measured
        // with a non-card box (e.g. a transient ghost stretched in a flex row, or a
        // not-yet-laid-out slot), trusting its raw height produces a "wide pill" in
        // flight. Force height from width × the canonical card aspect (5:7) so a flying
        // card can never become a pill, regardless of how the anchor was sized.
        const aspectH = readCardAspectH(overlayEl); // height/width ratio (≈1.4)
        if(aspectH>0) overlayEl.style.height = (r.width*aspectH)+'px';
      } else {
        // legacy non-framework cards: copy the anchor's resolved box styling.
        Object.assign(overlayEl.style,{borderRadius:cs.borderRadius,borderWidth:cs.borderWidth,borderStyle:cs.borderStyle,boxShadow:cs.boxShadow});
        if(overlayEl.classList.contains('board-card'))overlayEl.style.fontSize=Math.max(8,Math.min(30,r.width*0.42))+'px';
        if(overlayEl.classList.contains('f7-card'))overlayEl.style.fontSize=Math.max(7,Math.min(30,r.width*0.46))+'px';
      }
    }

    function restore(c){if(c.hidden){c.hidden.el.style.visibility=c.hidden.visibility||'';c.hidden=null;}}

    function create(face,location={},opts={}){
      const id=opts.id||('cm:'+(++_nextId));
      const card={id,face:{...face},faceUp:opts.faceUp??false,location:{...location},anchor:null,overlayEl:null,hidden:null,renderer:opts.renderer||null,meta:opts.meta||{}};
      cards.set(id,card);return id;
    }
    function get(id){return cards.get(id)||null;}
    function has(id){return cards.has(id);}
    function ids(){return [...cards.keys()];}
    function inZone(zone,filter={}){
      const result=[];
      for(const c of cards.values()){
        if(c.location.zone!==zone)continue;
        if(filter.player!=null&&c.location.player!==filter.player)continue;
        if(filter.slot!=null&&c.location.slot!==filter.slot)continue;
        result.push(c);
      }
      return result;
    }
    function destroy(id){
      const c=cards.get(id);if(!c)return;
      restore(c);if(c.overlayEl)c.overlayEl.remove();cards.delete(id);
    }
    function renderCard(c){
      if(!c||!c.renderer)return null;
      return c.renderer(c.face,c.faceUp);
    }
    // Ensure a card has an overlay element created and rendered.
    // Used by moveTo before flight — the overlay IS the card.
    function ensureOverlay(c){
      if(!c)return;
      if(!c.overlayEl){
        c.overlayEl=document.createElement('div');
        c.overlayEl.dataset.cmId=c.id;
        c.overlayEl.classList.add('kit-card-registered');
        document.body.appendChild(c.overlayEl);
      }
      const rendered=renderCard(c);
      if(rendered){
        c.overlayEl.className=rendered.className+' kit-card-registered';
        c.overlayEl.innerHTML=rendered.innerHTML;
        if(!rendered.innerHTML)c.overlayEl.textContent=rendered.textContent||'';
        for(const attr of [...rendered.attributes]){
          if(attr.name!=='class')c.overlayEl.setAttribute(attr.name,attr.value);
        }
        if(rendered.style.cssText)c.overlayEl.style.cssText+=';'+rendered.style.cssText;
      }
      c.overlayEl.style.position='fixed';
      c.overlayEl.style.pointerEvents='none';
      c.overlayEl.style.boxSizing='border-box';
    }
    function pin(id,anchor,opts={}){
      const c=cards.get(id);if(!c||!anchor)return;
      restore(c);
      if(!c.overlayEl){
        c.overlayEl=document.createElement('div');
        c.overlayEl.dataset.cmId=id;
        c.overlayEl.classList.add('kit-card-registered');
        document.body.appendChild(c.overlayEl);
      }
      if(opts.updateContent!==false){
        const rendered=renderCard(c);
        if(rendered){
          c.overlayEl.className=rendered.className+' kit-card-registered';
          c.overlayEl.innerHTML=rendered.innerHTML;
          if(!rendered.innerHTML)c.overlayEl.textContent=rendered.textContent||'';
          for(const attr of [...rendered.attributes]){
            if(attr.name!=='class')c.overlayEl.setAttribute(attr.name,attr.value);
          }
          // Copy computed inline styles (background, color, border) that
          // the renderer sets directly on the element.
          if(rendered.style.cssText)c.overlayEl.style.cssText+=';'+rendered.style.cssText;
        }
      }
      c.overlayEl.style.zIndex=opts.zIndex||80;
      c.overlayEl.style.position='fixed';
      c.overlayEl.style.pointerEvents='none';
      c.overlayEl.style.boxSizing='border-box';
      c.anchor=anchor;
      positionOverlay(c.overlayEl,anchor);
      if(opts.hideAnchor!==false){
        c.hidden={el:anchor,visibility:anchor.style.visibility};
        anchor.style.visibility='hidden';
      }
    }
    function unpin(idOrCard){
      const c=typeof idOrCard==='string'?cards.get(idOrCard):idOrCard;
      if(!c)return;
      restore(c);
      if(c.overlayEl)c.overlayEl.style.opacity='0';
      c.anchor=null;
    }
    function sync(){
      for(const c of cards.values()){
        if(c.anchor&&c.overlayEl)positionOverlay(c.overlayEl,c.anchor);
      }
    }
    async function moveTo(id,toAnchor,opts={}){
      const c=cards.get(id);if(!c)return;
      if(!toAnchor)return;

      // ── Permanent Card: the overlay IS the card. No clone. ──
      // Ensure overlay exists and is rendered.
      ensureOverlay(c);
      const el=c.overlayEl;
      const duration=opts.duration??520;

      // Re-seat overlay at its current anchor before flight. This guarantees
      // correct fromRect even if anything reset the overlay's inline position
      // between the caller's pin() and this moveTo().
      if(c.anchor) positionOverlay(el,c.anchor);

      // Unhide source anchor (card is leaving it)
      restore(c);
      c.anchor=null;

      // Snapshot source position from current overlay
      const fromRect=el.getBoundingClientRect();

      // Show card-back before flight if requested. backClass (optional) lets a
      // game apply its themed card-back styling for the face-down flight; the
      // class is removed when the face is revealed (revealMidway) or on arrival.
      let appliedBackClass=null;
      if(opts.startFaceDown&&opts.backHTML){
        const back=nodeFromHTML(opts.backHTML);
        if(back){el.innerHTML=back.innerHTML;el.style.background=getComputedStyle(back).background||'var(--card-back)';el.style.color='';}
        if(opts.backClass){el.classList.add(opts.backClass);appliedBackClass=opts.backClass;}
      }

      // Raise z-index during flight so card flies above everything
      el.style.zIndex=opts.zIndex??1000;
      // Animate the SIZE change with transform:scale (not raw width/height) so the
      // whole card — including its font/content — scales UNIFORMLY in flight. The
      // overlay keeps its source box size during the flight and we scale toward
      // the destination; positionOverlay() snaps to the exact dest size on land.
      el.style.transition=`top ${duration}ms var(--spring-soft),left ${duration}ms var(--spring-soft),transform ${duration}ms var(--spring-soft)`;
      el.classList.add('kit-card-moving');
      el.offsetHeight; // force reflow

      // Hide the destination anchor for the ENTIRE flight (default), so the only
      // thing the viewer sees is the single flying card — exactly like a clean
      // hand-dealt card. It is revealed (or stays covered by the overlay) on land.
      const savedTargetVis=toAnchor.style.visibility;
      if(opts.hideTarget!==false) toAnchor.style.visibility='hidden';

      // Arc: fly to midpoint.
      // Rotation styles (choose at most one via opts):
      //   • flip  → rotateY: reads as the card flipping over (back→front) and
      //             always lands face-UP/upright. Pairs with revealMidway so the
      //             face is swapped in while the card is edge-on (~90deg).
      //   • spin  → rotateZ: a playful in-plane spin (note: rotates the face
      //             content too, so prefer `flip` for dealt cards that reveal).
      el.style.transformOrigin='center';
      const midRot=opts.flip?'rotateY(90deg) ':(opts.spin?'rotateZ(180deg) ':'');
      const endRot=opts.flip?'rotateY(0deg) ':(opts.spin?'rotateZ(360deg) ':'');
      const toRect=stableRect(toAnchor)||toAnchor.getBoundingClientRect();
      // Uniform end-scale so the card (and its text) shrinks/grows proportionally
      // toward the destination size. The overlay keeps its source box during the
      // flight; we position by CENTER so scaling stays anchored correctly.
      const endScale=fromRect.width>0?(toRect.width/fromRect.width):1;
      const srcCx=fromRect.left+fromRect.width/2, srcCy=fromRect.top+fromRect.height/2;
      const dstCx=toRect.left+toRect.width/2, dstCy=toRect.top+toRect.height/2;
      // Reposition via centers (translate from the source top-left baseline).
      const cx2lx=(cx)=>cx-fromRect.width/2; // center-x → left for a source-sized box
      const cy2ty=(cy)=>cy-fromRect.height/2;
      const midX=(srcCx+dstCx)/2, midY=Math.min(srcCy,dstCy)-(opts.arc??46);
      const midScale=((opts.midScale??1.12))*((1+endScale)/2); // ease size through the arc
      requestAnimationFrame(()=>{
        el.style.left=cx2lx(midX)+'px';
        el.style.top=cy2ty(midY)+'px';
        el.style.transform=midRot+'scale('+midScale+')';
      });

      // Reveal face at midpoint
      if(opts.startFaceDown&&opts.revealMidway){
        setTimeout(()=>{
          const front=renderCard(c);
          if(front){
            // Clear the face-down inline visuals first so a card whose face is
            // styled purely by CSS class (e.g. gold +N modifiers) is not left
            // with the leftover card-back background/border/color from the flight.
            el.style.background='';el.style.borderColor='';el.style.color='';
            if(appliedBackClass){el.classList.remove(appliedBackClass);appliedBackClass=null;}
            el.className=front.className+' kit-card-registered kit-card-moving';
            el.innerHTML=front.innerHTML;
            if(front.style.cssText)el.style.cssText+=';'+front.style.cssText;
            el.style.animation='popReveal .26s var(--spring)';
          }
          if(opts.onReveal)opts.onReveal();
        },Math.floor(duration*(opts.revealAt??0.42)));
      }

      // Fly to destination: position by center, scale uniformly to the dest size
      // (width/height stay at source values; transform does the sizing).
      setTimeout(()=>{
        el.style.left=cx2lx(dstCx)+'px';
        el.style.top=cy2ty(dstCy)+'px';
        el.style.transform=endRot+'scale('+endScale+')';
      },Math.floor(duration*0.5));

      await sleep(duration);

      // ── Clean hand-off (single snap, no flicker) ──
      // Turn OFF the transition first, then in the same frame set the overlay to
      // the anchor's exact box (width/height/font) with transform cleared. Because
      // the transition is off, there is no animated "snap back" from scale(end) to
      // the native size — the card simply settles into place.
      el.style.transition='none';
      el.classList.remove('kit-card-moving');
      if(appliedBackClass)el.classList.remove(appliedBackClass);
      el.style.animation='';
      el.style.transform='';
      if(opts.toLocation)c.location={...opts.toLocation};
      c.anchor=toAnchor;
      positionOverlay(el,toAnchor); // exact dest box + font in one shot
      el.style.zIndex=opts.zIndex||80;
      el.offsetHeight; // commit the settled frame before any further transitions
      // The overlay now perfectly covers the (hidden) anchor and IS the card.
      if(opts.hideTarget!==false){
        c.hidden={el:toAnchor,visibility:savedTargetVis||''};
        // anchor already hidden for the flight; keep it hidden (overlay is the card)
      } else {
        toAnchor.style.visibility=savedTargetVis||'';
      }
      // A subtle settle-bounce on the OVERLAY itself (not the hidden anchor), so
      // the landing reads cleanly like the preview.
      if(opts.land!==false){ el.classList.remove('anim-land'); void el.offsetWidth; el.classList.add('anim-land'); }
      if(opts.onArrive)opts.onArrive(toAnchor);
    }
    async function flipCard(id,faceUp){
      const c=cards.get(id);if(!c)return;
      c.faceUp=faceUp;
      if(c.overlayEl){
        c.overlayEl.classList.remove('anim-flip');void c.overlayEl.offsetWidth;c.overlayEl.classList.add('anim-flip');
        await sleep(210);
        const rendered=renderCard(c);
        if(rendered){c.overlayEl.className=rendered.className+' kit-card-registered anim-flip';c.overlayEl.innerHTML=rendered.innerHTML;if(!rendered.innerHTML)c.overlayEl.textContent=rendered.textContent;}
        await sleep(210);
      }
    }
    // Rename a card's id in place (keeps the SAME overlay element, anchor, and
    // hidden state). Lets a moving card "become" a permanent slot/pile card after
    // it lands — no destroy/recreate, so it stays visible with no gap. If newId is
    // already taken, that card is destroyed first.
    function rename(oldId,newId,location){
      const c=cards.get(oldId);if(!c||oldId===newId)return;
      if(cards.has(newId))destroy(newId);
      cards.delete(oldId);
      c.id=newId;
      if(c.overlayEl)c.overlayEl.dataset.cmId=newId;
      if(location)c.location={...location};
      cards.set(newId,c);
    }
    function clear(prefix=''){for(const id of [...cards.keys()])if(!prefix||id.startsWith(prefix))destroy(id);}
    function reconcile(prefix,activeIds){const keep=new Set(activeIds||[]);for(const id of [...cards.keys()])if(id.startsWith(prefix)&&!keep.has(id))destroy(id);}
    function verifyInvariants(){
      const errors=[],warnings=[],locMap=new Map();
      // 1) Collision check (existing) — two cards in the same logical zone slot.
      for(const c of cards.values()){
        if(c.location.zone==='transit'||c.location.zone==='removed'||c.location.zone==='deck'||c.location.zone==='discard')continue;
        const key=`${c.location.zone}:p${c.location.player??'x'}:s${c.location.slot??'x'}`;
        if(locMap.has(key))errors.push(`COLLISION: ${c.id} and ${locMap.get(key)} at ${key}`);
        locMap.set(key,c.id);
      }
      // 2) Orphan overlay — a DOM node with data-cm-id but no card record.
      //    These are the most common animation-glitch sources (ghost cards left
      //    behind after a transition); always a bug.
      const allOverlays = document.querySelectorAll('[data-cm-id]');
      const knownIds = new Set([...cards.values()].map((c) => c.id));
      for (const node of allOverlays) {
        const id = node.getAttribute('data-cm-id');
        if (!knownIds.has(id)) errors.push(`ORPHAN_OVERLAY: ${id} has DOM node but no card record`);
      }
      // 3) Anchor with stale data-card-reg — an anchor pointing at a card that
      //    no longer exists in the registry (often a sign the card was destroyed
      //    while still pinned). Warning, not error, because the live render
      //    sweeps these on next sync.
      const anchors = document.querySelectorAll('[data-card-reg]');
      for (const a of anchors) {
        const ref = a.getAttribute('data-card-reg');
        if (ref && !knownIds.has(ref)) warnings.push(`STALE_ANCHOR: ${ref} referenced but no card`);
      }
      // 4) Card record with overlayEl detached from the DOM — usually means a
      //    parent was innerHTML='ed during an animation. Hard to recover from.
      for (const c of cards.values()) {
        if (c.overlayEl && !document.body.contains(c.overlayEl)) {
          errors.push(`DETACHED_OVERLAY: ${c.id} overlay no longer in DOM`);
        }
      }
      return {ok:errors.length===0,errors,warnings};
    }
    // ── Transient fly: a one-off card flight between two DOM points, no
    //    permanent identity/location. Reuses moveTo() so it shares the exact same
    //    clean, uniform-scale flight. The temp card is destroyed on arrival.
    //    opts: render()->Element (preferred) OR {value,color}; plus the usual
    //    flight opts (spin, flip, startFaceDown, revealMidway, duration, arc,
    //    land, hideTarget, hideSource, onArrive, onReveal).
    async function flyTransient(fromEl,toEl,opts={}){
      if(!fromEl||!toEl)return;
      const id='cm:transit:'+(++_nextId);
      const renderer=opts.render
        ? ()=>opts.render()
        : ()=>{const e=document.createElement('div');e.className=opts.className||'card-slot revealed';e.textContent=opts.value??'';if(opts.color)e.style.color=opts.color;return e;};
      create({kind:opts.kind||'generic',value:opts.value??''},{zone:'transit'},{id,faceUp:!opts.startFaceDown,renderer});
      const prevSrcVis=opts.hideSource?fromEl.style.visibility:null;
      if(opts.hideSource)fromEl.style.visibility='hidden';
      pin(id,fromEl,{hideAnchor:false,updateContent:true});
      await moveTo(id,toEl,{...opts,toLocation:{zone:'transit'},hideTarget:opts.hideTarget===true});
      if(opts.hideSource)fromEl.style.visibility=prevSrcVis||'';
      destroy(id);
    }
    // ── In-place flip/reveal of ANY element (managed or a plain board DOM node).
    //    If the element is a managed overlay we flip via flipCard; otherwise we
    //    animate the element directly. Replaces the old Card.reveal/flip.
    async function revealEl(el,value,{color=null,faceUp=true,duration=420}={}){
      if(!el)return;
      el.classList.remove('anim-flip');void el.offsetWidth;el.classList.add('anim-flip');
      await sleep(duration/2);
      if(faceUp){ if(value!=null)el.textContent=value; if(color)el.style.color=color; el.classList.remove('face-down');el.classList.add('revealed'); }
      else { el.textContent='';el.style.color='';el.classList.add('face-down');el.classList.remove('revealed'); }
      await sleep(duration/2);
    }
    // ── Composite: a triplet/clear effect — tilt-stack the cards, fly them to the
    //    discard, then settle. Cards are board DOM elements (or overlays).
    async function triplet({cards=[],discardEl=null,value=null,color=null,boardEl=null,render=null}={}){
      if(boardEl)floatText(boardEl,'Triplet!','#eab308');
      if(typeof SFX!=='undefined')SFX.triplet();
      // tilt-stack
      for(let i=0;i<cards.length;i++){const el=cards[i];if(!el)continue;el.style.transition='transform 180ms var(--spring-soft)';el.style.transform=`rotate(${(i-(cards.length-1)/2)*10}deg)`;await sleep(70);}
      // fly each to discard (transient), staggered
      for(let i=0;i<cards.length;i++){const el=cards[i];if(!el||!discardEl)continue;await flyTransient(el,discardEl,{render:render?()=>render():null,value,color,spin:true,duration:560,land:false,hideSource:true});await sleep(60);}
      for(const el of cards){if(el){el.style.transition='transform 180ms var(--spring-soft)';el.style.transform='';}}
    }
    return {create,get,has,ids,inZone,destroy,pin,unpin,sync,moveTo,flyTransient,flip:flipCard,revealEl,triplet,rename,clear,reconcile,renderCard,verifyInvariants};
  })();

  // ── Unified card VISUAL — one look across every game ──────────────────────
  // Build a `.kit-card` element from a small spec. Games describe WHAT a card is
  // (value/suit/face-down/extra classes); they no longer hand-roll markup. This is
  // the single place the shared card design lives, so the whole hub looks coherent.
  //   spec: { value, suit, faceDown, kind, html, className, pips, sm, xs }
  function cardFace(spec={}){
    const el=document.createElement('div');
    el.className='kit-card'+(spec.sm?' kit-sm':'')+(spec.xs?' kit-xs':'')+(spec.className?' '+spec.className:'');
    if(spec.faceDown){el.classList.add('kit-face-down');return el;}
    if(spec.suit)el.dataset.suit=spec.suit;
    if(spec.kind)el.dataset.kind=spec.kind;
    if(spec.html!=null){el.innerHTML=spec.html;return el;}
    const v=spec.value;
    if(spec.pips!==false&&v!=null&&v!==''){
      el.innerHTML=`<span class="kit-pip tl">${v}</span><span class="kit-val">${v}</span><span class="kit-pip br">${v}</span>`;
    }else if(v!=null){el.textContent=String(v);}
    return el;
  }

  // ── Unified card BOARD wiring — one create/pin/reconcile loop for every game ──
  // Every game used to repeat the same ~5-line sync loop: walk [data-card-reg]
  // anchors, create the permanent CardManager card if missing (else refresh its
  // renderer), pin the overlay onto the anchor, collect active ids, reconcile, sync.
  // CardBoard owns that loop AND the card-sized flight staging so no game can
  // reintroduce the "card scales to a container's width" bug or transient throwaways.
  const CardBoard=(()=>{
    // sync(prefix, opts): drive the whole board from the DOM anchors.
    //   opts.renderer(anchor)      -> { value, suit, faceDown, html, className, kind, sm, xs }
    //                                 OR an Element (advanced) — used as the card face.
    //   opts.location(anchor)      -> { zone, player, slot }  (defaults derive from data-*)
    //   opts.faceUp(anchor)        -> boolean (default true)
    //   opts.hideAnchor            -> hide the underlying anchor (default false; overlay sits on top)
    function sync(prefix,opts={}){
      const active=[];
      const renderFor=(anchor)=>{
        const out=opts.renderer?opts.renderer(anchor):null;
        return (out instanceof Element)?out:cardFace(out||{});
      };
      document.querySelectorAll(`[data-card-reg^="${prefix}"]`).forEach((anchor,index)=>{
        const id=anchor.dataset.cardReg;active.push(id);
        const faceUp=opts.faceUp?!!opts.faceUp(anchor):true;
        const location=opts.location?opts.location(anchor,index):{zone:'board',slot:index};
        const renderer=()=>renderFor(anchor);
        if(!CardManager.has(id)){
          CardManager.create({},location,{id,faceUp,renderer});
        }else{
          const c=CardManager.get(id);if(c){c.renderer=renderer;if(location)c.location={...location};}
        }
        CardManager.pin(id,anchor,{hideAnchor:opts.hideAnchor===true,updateContent:true});
      });
      CardManager.reconcile(prefix,active);
      requestAnimationFrame(()=>CardManager.sync());
      return active;
    }
    // snapshot(prefix): capture each managed overlay's CURRENT screen rect before a
    // DOM rebuild, so a card that changes zones can fly from its true previous spot.
    function snapshot(prefix){
      const rects={};
      for(const id of CardManager.ids()){
        if(prefix&&!id.startsWith(prefix))continue;
        const c=CardManager.get(id);
        if(c&&c.overlayEl){const r=c.overlayEl.getBoundingClientRect();if(r.width>0)rects[id]={left:r.left,top:r.top,width:r.width,height:r.height};}
      }
      return rects;
    }
    // A card-sized, invisible, fixed-position proxy at an absolute rect. The flight
    // SOURCE must be card-sized (never a wide container) or the card balloons toward
    // the container width. Returns an element to pin to; auto-removed after the fly.
    function rectAnchor(rect){
      const el=document.createElement('div');
      el.style.cssText=`position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;visibility:hidden`;
      el.dataset.kitProxy='1';document.body.appendChild(el);return el;
    }
    // fly(id, opts): move a PERMANENT card to its destination anchor, staging the
    // source correctly. Pass exactly one source: fromRect (e.g. from snapshot()),
    // fromEl (a real card-sized element like a deck), or neither (uses current spot).
    //   opts.to            -> destination anchor Element (required)
    //   opts.fromRect      -> {left,top,width,height}
    //   opts.fromEl        -> source Element (should be card-sized)
    //   ...rest            -> forwarded to CardManager.moveTo (duration, arc, flip, …)
    async function fly(id,opts={}){
      const {to,fromRect,fromEl,...moveOpts}=opts;
      if(!to||!CardManager.has(id))return;
      let proxy=null;
      if(fromRect){proxy=rectAnchor(fromRect);CardManager.pin(id,proxy,{hideAnchor:false,updateContent:true});}
      else if(fromEl){CardManager.pin(id,fromEl,{hideAnchor:false,updateContent:moveOpts.updateContent!==false});}
      // else: fly from wherever the card currently sits (its overlay position).
      await CardManager.moveTo(id,to,moveOpts);
      if(proxy)proxy.remove();
    }
    // playReflow(beforeRects, opts): FLIP-animate managed overlays that SHIFTED after
    // a DOM rebuild. Pass the rects from a prior snapshot(prefix); each overlay whose
    // current pinned position differs is translated from its old spot to the new one
    // (transform-only, GPU-cheap). This is the shared primitive for "a card moved
    // because siblings reflowed" (e.g. a new card pushed the row over) — replaces
    // per-game getBoundingClientRect reflow math.
    function playReflow(beforeRects,opts={}){
      if(!beforeRects)return;
      const dur=opts.duration??340, minShift=opts.minShift??3;
      CardManager.sync(); // ensure overlays are at their new resting positions first
      for(const id in beforeRects){
        if(!CardManager.has(id))continue;
        const c=CardManager.get(id); const el=c&&c.overlayEl; if(!el)continue;
        const b=el.getBoundingClientRect(); const a=beforeRects[id];
        const dx=a.left-b.left, dy=a.top-b.top;
        if(Math.abs(dx)+Math.abs(dy)<minShift)continue;
        el.style.transition='none';
        el.style.transform=`translate(${dx}px,${dy}px)`;
        el.offsetHeight; // commit the start frame
        el.style.transition=`transform ${dur}ms var(--spring-soft)`;
        requestAnimationFrame(()=>{el.style.transform='';});
        setTimeout(()=>{el.style.transition='';el.style.transform='';},dur+50);
      }
    }
    return {sync,snapshot,rectAnchor,fly,playReflow};
  })();

  // Dev-mode invariant guard. Off by default; enable in the console with
  //   localStorage.setItem('cardDebug','1')   (then reload)
  // When on, after each render we assert the single-location invariant and warn
  // (never throw) so card-collision regressions surface during development.
  const CARD_DEBUG = (()=>{ try { return localStorage.getItem('cardDebug')==='1'; } catch { return false; } })();
  function assertCardInvariants(where){
    if(!CARD_DEBUG)return;
    const r=CardManager.verifyInvariants();
    if(!r.ok)console.warn('[CardManager] invariant violation'+(where?(' @'+where):'')+':',r.errors);
  }

  window.addEventListener('resize',()=>CardManager.sync(),{passive:true});
  window.addEventListener('scroll',()=>CardManager.sync(),{passive:true});
  const _kitExports = {cardColor,floatText,turnBanner,dealCascade,EventRunner,CardManager,CardBoard,cardFace,assertCardInvariants,rollDice,confetti};
  // API-10: expose Kit on window for tests/smokes so they can verify
  // animation health (verifyInvariants) without lexical access. The
  // production code still references the script-scoped const directly,
  // so this is purely additive.
  try { window.Kit = _kitExports; } catch {}
  return _kitExports;
})();

/* ====================== SOUND (arcade) ====================== */
const SFX=(()=>{
  let ctx=null,master=null,muted=localStorage.getItem('hub_muted')==='1';
  function ensure(){if(ctx)return;try{ctx=new(window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=0.22;master.connect(ctx.destination);}catch(e){ctx=null;}}
  function resume(){if(ctx&&ctx.state==='suspended')ctx.resume();}
  function tone({freq=440,dur=0.12,type='square',vol=1,glideTo=null,delay=0,attack=0.005,decay=0.08}={}){if(!ctx||muted)return;const t0=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t0);if(glideTo)o.frequency.exponentialRampToValueAtTime(glideTo,t0+dur);g.gain.setValueAtTime(0.0001,t0);g.gain.exponentialRampToValueAtTime(vol,t0+attack);g.gain.exponentialRampToValueAtTime(0.0001,t0+attack+decay+dur);o.connect(g);g.connect(master);o.start(t0);o.stop(t0+attack+decay+dur+0.02);}
  function chord(fs,o={}){fs.forEach((f,i)=>tone({...o,freq:f,delay:(o.delay||0)+i*(o.spread??0.04)}));}
  const api={get muted(){return muted;},unlock(){ensure();resume();},setMuted(m){muted=m;localStorage.setItem('hub_muted',m?'1':'0');if(!m){ensure();resume();}},toggle(){api.setMuted(!muted);return muted;},
    tap(){tone({freq:520,dur:0.04,type:'triangle',vol:0.5});},draw(){tone({freq:300,glideTo:560,dur:0.14,type:'sawtooth',vol:0.6});},flip(){tone({freq:660,glideTo:880,dur:0.1,type:'square',vol:0.55});},
    reveal(){tone({freq:740,dur:0.07,type:'square',vol:0.5});tone({freq:988,dur:0.1,type:'square',vol:0.4,delay:0.05});},discard(){tone({freq:420,glideTo:200,dur:0.13,type:'sawtooth',vol:0.55});},
    swap(){tone({freq:500,glideTo:760,dur:0.1,type:'square',vol:0.5});tone({freq:760,dur:0.08,type:'triangle',vol:0.4,delay:0.07});},good(){chord([660,880,1175],{dur:0.12,type:'square',vol:0.4,spread:0.05});},
    bad(){tone({freq:300,glideTo:160,dur:0.2,type:'sawtooth',vol:0.5});},triplet(){chord([523,659,784,1047],{dur:0.16,type:'square',vol:0.45,spread:0.06});},
    yourTurn(){chord([587,880],{dur:0.14,type:'triangle',vol:0.5,spread:0.08});},lastRound(){tone({freq:880,glideTo:440,dur:0.3,type:'sawtooth',vol:0.5});},
    win(){chord([523,659,784,1047,1319],{dur:0.22,type:'square',vol:0.5,spread:0.09});},deal(){tone({freq:240+Math.random()*80,dur:0.05,type:'triangle',vol:0.35});},join(){chord([440,660],{dur:0.1,type:'triangle',vol:0.4,spread:0.06});}};
  ['pointerdown','keydown','touchstart'].forEach(ev=>window.addEventListener(ev,()=>api.unlock(),{passive:true}));
  return api;
})();
function toggleSound(){const m=SFX.toggle();const b=$('soundBtn');if(b){b.innerHTML='';b.appendChild(Kit.Icon(m?'sound-off':'sound-on',{size:20}));b.classList.toggle('off',m);}if(!m)SFX.tap();}

/* ====================== HUB STATE ====================== */
let mode='online';            // 'online' | 'local'
let myName='';
let catalogue=[];             // [{id,name,minPlayers,maxPlayers,description,emoji}]
let curView=null;             // last game view rendered
let prevView=null;
let animating=false,pendingView=null;
let summaryShown=false,lastRoundShown=false;

const net={ws:null,room:null,isHost:false,spectating:false,lobbyWs:null,
  send(o){if(this.ws&&this.ws.readyState===1)this.ws.send(JSON.stringify(o));}};
let _vis='public',_maxPlayers=8;
function setVis(v){_vis=v;document.querySelectorAll('#visSeg button').forEach(b=>b.classList.toggle('on',b.dataset.vis===v));}
function bumpMax(d){_maxPlayers=Math.max(2,Math.min(8,_maxPlayers+d));$('maxVal').textContent=_maxPlayers;}
function randomCode(){const w=['CREW','SKY','BLUE','STAR','MOON','FOX','PEAR','WAVE','GOLD','NEON'];$('hostRoom').value=w[Math.floor(Math.random()*w.length)]+Math.floor(Math.random()*90+10);}
function ensureName(){
  // Prefer the typed value; fall back to the saved Identity name; fall back to
  // a random Player_NNN — and remember whatever we end up with for next time.
  myName=$('onlineName').value.trim();
  if(!myName && window.Identity) myName = (window.Identity.getName()||'').trim();
  if(!myName){myName='Player_'+Math.floor(Math.random()*1000);}
  $('onlineName').value=myName;
  if(window.Identity) Identity.setName(myName);
  return myName;
}
function goOnline(){
  // Restore saved name from Identity into the input so users don't retype it.
  const inp=$('onlineName');
  if(inp && !inp.value && window.Identity){ inp.value = Identity.getName() || ''; }
  if(typeof syncOnlinePrimaryName==='function'){syncOnlinePrimaryName();renderOnlineDevicePlayers();}
  showScreen('onlineSetup');
}


/* ====================== SHARED TABLE SHELL / SEAT MODEL ====================== */
const SeatModel={
  controlled(){return Array.isArray(window._controlledSeats)?window._controlledSeats:[];},
  localHumanSeats(){return (typeof localSeats!=='undefined')?localSeats.map((s,i)=>!s.bot?i:-1).filter(i=>i>=0):[];},
  isLocalBot(seat){return typeof localSeats!=='undefined'&&!!localSeats[seat]?.bot;},
  firstHuman(){const hs=this.localHumanSeats();return hs.length?hs[0]:0;},
  resolve({actingSeat=-1,eventSeat=null,preferred=null,mode:modeArg=mode}={}){
    const controlled=modeArg==='local'?this.localHumanSeats():this.controlled();
    if(preferred!=null&&controlled.includes(preferred))return preferred;
    if(eventSeat!=null&&controlled.includes(eventSeat))return eventSeat;
    if(actingSeat>=0&&controlled.includes(actingSeat))return actingSeat;
    return controlled[0]??(actingSeat>=0?actingSeat:0);
  }
};
const GameShell=(()=>{
  let current=null;
  function el(content){
    if(content==null)return null;
    if(content instanceof Node)return content;
    const t=document.createElement('template');t.innerHTML=String(content).trim();
    return t.content;
  }
  function setHTML(target,content){
    if(!target)return;
    target.innerHTML='';
    const node=el(content); if(node)target.appendChild(node);
  }
  function clearGlobal(){
    const mini=$('miniBoardsContainer');if(mini){mini.innerHTML='';mini.className='mini-boards-container';}
    const main=$('mainBoardsContainer');if(main)main.innerHTML='';
    const top=$('topArea');if(top){top.querySelectorAll('.game-shell-center,.qwixx-dice-zone,.qwixx-top-mini-strip').forEach(n=>n.remove());}
    const f7=$('f7Controls');if(f7)f7.remove();
    const dw=$('f7DealerWrap');if(dw)dw.remove();
    if(typeof Kit!=='undefined'&&Kit.CardManager)Kit.CardManager.clear();
    $('investigateOverlay')?.classList.add('hidden');
  }
  function restoreSharedTop(){
    const top=$('topArea');if(!top)return;
    top.style.display='';
    const piles=top.querySelector('.piles');if(piles)piles.style.display='flex';
    const held=$('heldCardWrapper');if(held)held.style.display='';
  }
  function unmount(next=null){
    if(current&&window.GameClients?.[current]?.unmount)window.GameClients[current].unmount();
    clearGlobal(); restoreSharedTop();
    // Reset shared-turn detection so a future game in the same session
    // doesn't see a stale "currentSeat" from the previous game.
    try { Kit?.Turn?.reset?.(current); } catch {}
    try { Kit?.PassPlay?.reset?.(current); } catch {}
    // Drop any per-game persisted nodes (Qwixx's dice canvas etc) so a fresh
    // entry to the same game starts with a clean slate.
    try { clearPersisted(); } catch {}
    current=next;
  }
  function render(view,client){
    if(current!==view.game){unmount(view.game);}
    if(client.mount&&!client._mounted){client.mount();client._mounted=true;}
    // W2: pass-and-play turn transition. Runs BEFORE the game renders so
    // the leaving-board animation is on-screen while the new render swaps
    // in beneath it. No-op for online play / single-human / bot-vs-bot.
    try { Kit?.PassPlay?.beforeRender?.(view); } catch (e) { console.warn('Kit.PassPlay.beforeRender threw', e); }
    client.render(view,ctx(view));
    try { Kit?.PassPlay?.afterRender?.(view); } catch (e) { console.warn('Kit.PassPlay.afterRender threw', e); }
    // API-9: shared turn detection runs AFTER the game has updated its DOM,
    // so the banner shows with the new layout already on screen. Games that
    // need to suppress it during an animation pipeline can call
    // Kit.Turn.update(view, {quiet:true}) themselves; this is the default path.
    try { Kit?.Turn?.update?.(view); } catch (e) { console.warn('Kit.Turn.update threw', e); }
  }
  // Shared inspect overlay (the "look at another player's board" popup). Games used
  // to poke $('investigateBox')/$('investigateOverlay') directly; route them through
  // here so there is ONE open/close path (also reachable outside render via the
  // GameShell exports, since inspect is usually fired from a later onclick).
  // content may be an HTML string OR a DOM node (setHTML handles both); returns the
  // #investigateBox so callers that build their board with appendChild can keep doing so.
  function inspect(content){const box=$('investigateBox');setHTML(box,content);$('investigateOverlay').classList.remove('hidden');return box;}
  function closeInspect(){$('investigateOverlay')?.classList.add('hidden');}
  function ctx(view){
    return {
      mode,
      controlledSeats:SeatModel.controlled(),
      focus:(opts={})=>SeatModel.resolve(opts),
      inspect,
      closeInspect,
      renderTable,
      clear:clearGlobal,
      // Per-game persistent DOM nodes (e.g. Qwixx's dice canvas). See
      // GameShell.persist documentation.
      persist,
    };
  }
  // Persisted-node registry: games can stash a DOM node here (keyed by an
  // arbitrary string) and the shell guarantees the node SURVIVES every
  // renderTable() call. Used for the Qwixx dice canvas — a WebGL context is
  // expensive to recreate and visually disruptive if torn out and rebuilt
  // every state tick. Cleared on game unmount.
  //
  // Usage:
  //   const tray = GameShell.persist('qwixx:dice', () => {
  //     const d = document.createElement('div'); d.className='qwixx-kit-dice'; return d;
  //   });
  //   // tray is the SAME node every call; mount it inside your center HTML
  //   // via a placeholder <span data-persist-slot="qwixx:dice"></span>.
  const _persisted = new Map();
  function persist(key, factory){
    let node = _persisted.get(key);
    if (!node){
      node = factory ? factory() : document.createElement('div');
      node.setAttribute('data-persist-id', key);
      _persisted.set(key, node);
    }
    return node;
  }
  function clearPersisted(){
    for (const [, node] of _persisted){
      // Detach from wherever it currently lives so the next render can re-mount it.
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    _persisted.clear();
  }

  // Re-mount any persisted nodes into matching placeholders after the shell
  // has rebuilt the center HTML. The placeholder is replaced (not appended)
  // so layout positions stay accurate (the placeholder can carry sizing CSS).
  function mountPersistedSlots(root){
    if (!root) return;
    const slots = root.querySelectorAll('[data-persist-slot]');
    for (const slot of slots){
      const key = slot.getAttribute('data-persist-slot');
      const node = _persisted.get(key);
      if (!node) continue;
      // Copy any classes / inline styles from the slot onto the persisted node
      // so per-render visual tweaks still apply.
      if (slot.className) node.className = slot.className;
      if (slot.id && !node.id) node.id = slot.id;
      slot.parentNode.replaceChild(node, slot);
    }
  }

  // Declarative table renderer. Games provide fragments; the shell owns where
  // they go and guarantees prior game fragments are removed.
  function renderTable({game='',opponents='',center='',focus='',status='',topMode='custom',opponentClass=''}={}){
    const mini=$('miniBoardsContainer'),top=$('topArea'),main=$('mainBoardsContainer'),sb=$('statusBar');
    if(mini){mini.innerHTML='';mini.className='mini-boards-container '+opponentClass;const node=el(opponents);if(node)mini.appendChild(node);mountPersistedSlots(mini);}
    if(top){
      top.querySelectorAll('.game-shell-center,.qwixx-dice-zone,.qwixx-top-mini-strip').forEach(n=>n.remove());
      const piles=top.querySelector('.piles'),held=$('heldCardWrapper');
      if(topMode==='piles'){top.style.display='';if(piles)piles.style.display='flex';if(held)held.style.display='';}
      else if(topMode==='hidden'){top.style.display='none';}
      else {top.style.display='flex';if(piles)piles.style.display='none';if(held)held.style.display='none';const c=document.createElement('div');c.className='game-shell-center '+game;const node=el(center);if(node)c.appendChild(node);top.appendChild(c);mountPersistedSlots(c);}
    }
    if(main){setHTML(main,focus);mountPersistedSlots(main);}
    if(sb&&status!=null)sb.innerHTML=status||'';
    if(typeof Kit!=='undefined'&&Kit.CardManager){requestAnimationFrame(()=>{Kit.CardManager.sync();Kit.assertCardInvariants&&Kit.assertCardInvariants('renderTable');});setTimeout(()=>Kit.CardManager.sync(),80);setTimeout(()=>Kit.CardManager.sync(),550);}
  }
  return {render,unmount,clearGlobal,renderTable,inspect,closeInspect,persist,clearPersisted,focus:(opts)=>SeatModel.resolve(opts)};
})();

/* ====================== CATALOGUE (single source of truth) ======================
   The catalogue comes from the SAME registry the server uses, bundled into the
   browser by 00-game-modules.js (loaded before this file). No hand-maintained
   fallback list to drift — adding a game to src/games/registry.ts is enough. The
   server still re-confirms its catalogue over the wire when you join a room. */
catalogue = (window.GameCatalogue || []).map(g => ({
  id: g.id, name: g.name, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
  description: g.description, emoji: g.emoji, features: g.features,
}));

/* ---- Rulebooks (accessible from menu, pickers, and inside a game) ---- */
function openRules(gameId){
  const r=window.GameRules?.[gameId];if(!r){showRulesMenu();return;}
  $('rulesBox').innerHTML=`<h2 style="margin:0 0 4px">${r.title}</h2><div class="muted" style="margin-bottom:10px">${r.quick}</div>
    <ol style="text-align:left;line-height:1.55;font-weight:600;padding-left:20px;margin:0 0 12px">${r.steps.map(s=>`<li style="margin-bottom:7px">${s}</li>`).join('')}</ol>
    <div style="background:var(--bg);border:2px solid var(--border);border-radius:12px;padding:10px;font-weight:700;text-align:left;display:flex;align-items:flex-start;gap:8px">${Kit.Icon.html('lightbulb',{size:16})}<span>${r.tip}</span></div>
    <button class="btn" style="margin-top:16px" onclick="$('rulesOverlay').classList.add('hidden')">Got it</button>`;
  $('rulesOverlay').classList.remove('hidden');
}
function showRulesMenu(){
  // Use Kit.Icon for the header glyph; rules-text emoji on game tiles is
  // legacy game-meta and stays (each game module declares its own emoji).
  $('rulesBox').innerHTML=`<h2 style="margin:0 0 12px;display:flex;align-items:center;gap:8px">${Kit.Icon.html('book',{size:22})}How to Play</h2>
    <div class="game-tiles">${catalogue.map(g=>`<div class="game-tile" onclick="openRules('${esc(g.id)}')"><div class="emoji">${esc(g.emoji)}</div><div class="gname">${esc(g.name)}</div></div>`).join('')}</div>
    <button class="btn secondary" style="margin-top:14px" onclick="$('rulesOverlay').classList.add('hidden')">Close</button>`;
  $('rulesOverlay').classList.remove('hidden');
}

// Tiles, with a group-size filter: games that don't fit `n` players are greyed out.
// `n` null = no filter (menus/quick play). Each tile has a ? for its rulebook.
function renderTiles(containerId,onPick,n=null){
  const el=$(containerId);
  el.innerHTML=catalogue.map(g=>{
    const fits = n==null || (n>=g.minPlayers && n<=g.maxPlayers);
    const why = n!=null && !fits ? (n<g.minPlayers?`Needs ${g.minPlayers}+`:`Max ${g.maxPlayers}`) : `${g.minPlayers}–${g.maxPlayers} players`;
    return `<div class="game-tile${fits?'':' disabled'}" data-g="${esc(g.id)}" data-fits="${fits}">
      <button class="tile-help" data-help="${esc(g.id)}" title="Rules">?</button>
      <div class="emoji">${esc(g.emoji)}</div><div class="gname">${esc(g.name)}</div>
      <div class="gdesc">${esc(g.description)}</div><div class="gsize">${esc(why)}</div></div>`;
  }).join('');
  el.querySelectorAll('.tile-help').forEach(b=>b.onclick=e=>{e.stopPropagation();openRules(b.dataset.help);});
  el.querySelectorAll('.game-tile').forEach(t=>t.onclick=()=>{ if(t.dataset.fits==='true') onPick(t.dataset.g); else toast('Not playable with this group size.'); });
}
