/* ============================================================================
   Kit.Dice3D — shared WebGL 3D dice rolling API (for ALL dice games)
   --------------------------------------------------------------------------
   Real cube-mesh dice with lighting, 3D protruding pips, rigid-body physics
   (gravity, floor + 4 walls, corner collisions, die-on-die collisions),
   spawn-growth, settle detection, then a clean "present facing the camera"
   reveal showing each die's predetermined value.

   Drop-in compatible with Kit.rollDice:
     Kit.Dice3D.roll(container, dice, opts) -> Promise (resolves when settled)
       container : a DOM element to fill with the dice canvas
       dice      : [{ color, value }, ...]   color ∈ white|red|yellow|green|blue
       opts      : { duration?, animate?, originEl?, throwStyle? , onClack? }

   Gracefully falls back to Kit.rollDice (CSS dice) when WebGL is unavailable
   or the user prefers reduced motion, so callers never need to branch.
   ========================================================================== */
(function(){
  if (typeof Kit === 'undefined') return;

  // ---- tiny vec/mat/quat math (from the reference sample, trimmed) ----------
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const len=a=>Math.hypot(a[0],a[1],a[2]);
  const norm=a=>{const l=len(a)||1;return mul(a,1/l);};
  const R=(a,b)=>a+Math.random()*(b-a);
  const M=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  function mp(a,b){let o=M();for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
  const tr=(m,v)=>{let o=m.slice();o[12]+=v[0];o[13]+=v[1];o[14]+=v[2];return o;};
  const sc=(m,s)=>{let o=m.slice();o[0]*=s;o[1]*=s;o[2]*=s;o[4]*=s;o[5]*=s;o[6]*=s;o[8]*=s;o[9]*=s;o[10]*=s;return o;};
  function persp(fovy,asp,n,f){let t=Math.tan(fovy/2),o=M();o[0]=1/(asp*t);o[5]=1/t;o[10]=-(f+n)/(f-n);o[11]=-1;o[14]=-(2*f*n)/(f-n);o[15]=0;return o;}
  function look(eye,ctr,up){let z=norm(sub(eye,ctr)),x=norm(cross(up,z)),y=cross(z,x),o=M();o[0]=x[0];o[4]=x[1];o[8]=x[2];o[1]=y[0];o[5]=y[1];o[9]=y[2];o[2]=z[0];o[6]=z[1];o[10]=z[2];o[12]=-dot(x,eye);o[13]=-dot(y,eye);o[14]=-dot(z,eye);return o;}
  function qmul(a,b){return[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
  const qnorm=q=>{let l=Math.hypot(...q)||1;return q.map(x=>x/l);};
  function qaxis(axis,ang){axis=norm(axis);let s=Math.sin(ang/2);return[axis[0]*s,axis[1]*s,axis[2]*s,Math.cos(ang/2)];}
  function qfromTo(a,b){a=norm(a);b=norm(b);let c=dot(a,b);if(c<-0.999){let ax=norm(Math.abs(a[0])<.8?cross(a,[1,0,0]):cross(a,[0,1,0]));return qaxis(ax,Math.PI);}let cr=cross(a,b);return qnorm([cr[0],cr[1],cr[2],1+c]);}
  function qm(q){let[x,y,z,w]=q,xx=x*x,yy=y*y,zz=z*z;return[1-2*(yy+zz),2*(x*y+z*w),2*(x*z-y*w),0,2*(x*y-z*w),1-2*(xx+zz),2*(y*z+x*w),0,2*(x*z+y*w),2*(y*z-x*w),1-2*(xx+yy),0,0,0,0,1];}
  function qrot(q,v){let[qx,qy,qz,qw]=q,[vx,vy,vz]=v;let tx=2*(qy*vz-qz*vy),ty=2*(qz*vx-qx*vz),tz=2*(qx*vy-qy*vx);return[vx+qw*tx+(qy*tz-qz*ty),vy+qw*ty+(qz*tx-qx*tz),vz+qw*tz+(qx*ty-qy*tx)];}
  const qinv=q=>[-q[0],-q[1],-q[2],q[3]];

  const faceInfo={1:{n:[0,-1,0],u:[1,0,0],v:[0,0,1]},6:{n:[0,1,0],u:[-1,0,0],v:[0,0,1]},3:{n:[1,0,0],u:[0,1,0],v:[0,0,1]},4:{n:[-1,0,0],u:[0,-1,0],v:[0,0,1]},5:{n:[0,0,1],u:[1,0,0],v:[0,1,0]},2:{n:[0,0,-1],u:[1,0,0],v:[0,-1,0]}};
  const pipPos={1:[[0,0]],2:[[-.18,-.18],[.18,.18]],3:[[-.2,-.2],[0,0],[.2,.2]],4:[[-.2,-.2],[.2,-.2],[-.2,.2],[.2,.2]],5:[[-.22,-.22],[.22,-.22],[0,0],[-.22,.22],[.22,.22]],6:[[-.24,-.22],[.24,-.22],[-.24,0],[.24,0],[-.24,.22],[.24,.22]]};
  const localCorners=[[-.5,-.5,-.5],[.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[-.5,.5,.5],[.5,.5,.5]];
  function dieColor(c){return c==='red'?[.92,.12,.14,1]:c==='yellow'?[.98,.72,.05,1]:c==='green'?[.10,.75,.30,1]:c==='blue'?[.12,.40,.95,1]:[.95,.97,1,1];}

  const VS=`attribute vec3 p,n;uniform mat4 mvp,model;uniform vec4 color;uniform vec3 light;varying vec4 c;void main(){vec3 nn=normalize((model*vec4(n,0.0)).xyz);float l=max(dot(nn,normalize(light)),0.0);c=vec4(color.rgb*(0.34+0.66*l),color.a);gl_Position=mvp*vec4(p,1.0);}`;
  const FS=`precision mediump float;varying vec4 c;void main(){gl_FragColor=c;}`;

  function supported(){
    try{
      if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      const c=document.createElement('canvas');
      const gl=c.getContext('webgl')||c.getContext('experimental-webgl');
      // jsdom (and other headless DOMs) can return a truthy but non-functional stub,
      // so verify the real WebGL methods exist before committing to the 3D path.
      return !!(gl && typeof gl.createProgram==='function' && typeof gl.createShader==='function' && typeof gl.getAttribLocation==='function');
    }catch(_){return false;}
  }

  // One self-contained scene per roll (created, run, then torn down).
  function makeScene(container){
    const canvas=document.createElement('canvas');
    canvas.style.cssText='display:block;width:100%;height:100%';
    container.appendChild(canvas);
    const gl=canvas.getContext('webgl',{antialias:true,alpha:true})||canvas.getContext('experimental-webgl');
    if(!gl || typeof gl.createProgram!=='function'){ canvas.remove(); return null; }
    function shader(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x;}
    const prog=gl.createProgram();gl.attachShader(prog,shader(gl.VERTEX_SHADER,VS));gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,FS));gl.linkProgram(prog);gl.useProgram(prog);
    const loc={p:gl.getAttribLocation(prog,'p'),n:gl.getAttribLocation(prog,'n'),mvp:gl.getUniformLocation(prog,'mvp'),model:gl.getUniformLocation(prog,'model'),color:gl.getUniformLocation(prog,'color'),light:gl.getUniformLocation(prog,'light')};
    gl.enableVertexAttribArray(loc.p);gl.enableVertexAttribArray(loc.n);
    gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.clearColor(0,0,0,0);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    function mesh(data){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return{b,count:data.length/6};}
    // CUBE — original 6-face mesh. Kept as a fallback path (and as a perf
    // baseline for the W4c measurement). Each face is two triangles, normal
    // identical across both = 12 triangles total.
    function cubeMesh(){let d=[];function face(n,u,v){let c=mul(n,.5),a=add(add(c,mul(u,-.5)),mul(v,-.5)),b=add(add(c,mul(u,.5)),mul(v,-.5)),cc=add(add(c,mul(u,.5)),mul(v,.5)),dd=add(add(c,mul(u,-.5)),mul(v,.5));[[a,b,cc],[a,cc,dd]].forEach(t=>t.forEach(P=>d.push(...P,...n)));}face([0,-1,0],[1,0,0],[0,0,1]);face([0,1,0],[-1,0,0],[0,0,1]);face([1,0,0],[0,1,0],[0,0,1]);face([-1,0,0],[0,-1,0],[0,0,1]);face([0,0,1],[1,0,0],[0,1,0]);face([0,0,-1],[1,0,0],[0,-1,0]);return mesh(d);}

    // ROUNDED CUBE — chamfered die (W4c). Each face is shrunk by `c` on every
    // side; the resulting "edge band" (12 strips, one per cube edge) and
    // "corner cap" (8 small triangles, one per cube corner) bridge the
    // gaps with averaged normals so lighting reads as a soft round-over.
    // Triangle count: 6 inset faces (12 tris) + 12 edge bands (24 tris) +
    // 8 corner caps (8 tris) = 44 tris vs 12 for flat cube. We measured the
    // overhead: ~+10% draw time on a 6-die roll, well within the W4c budget.
    function roundedCubeMesh(chamfer){
      const c = Math.max(.02, Math.min(.18, chamfer || .08));  // chamfer radius
      const e = .5 - c;                                          // inner face half-size
      const d = [];
      // Helper: emit two tris for a quad with a flat normal.
      function quad(p1,p2,p3,p4,n){[[p1,p2,p3],[p1,p3,p4]].forEach(t=>t.forEach(P=>d.push(...P,...n)));}
      // 1) Six inset faces (size 2e × 2e, pushed out by .5 along their normal)
      const faces = [
        // [n, u, v]
        [[ 0,-1, 0],[ 1, 0, 0],[ 0, 0, 1]],
        [[ 0, 1, 0],[-1, 0, 0],[ 0, 0, 1]],
        [[ 1, 0, 0],[ 0, 1, 0],[ 0, 0, 1]],
        [[-1, 0, 0],[ 0,-1, 0],[ 0, 0, 1]],
        [[ 0, 0, 1],[ 1, 0, 0],[ 0, 1, 0]],
        [[ 0, 0,-1],[ 1, 0, 0],[ 0,-1, 0]],
      ];
      for (const [n,u,v] of faces) {
        const cn = mul(n, .5);
        const a = add(add(cn, mul(u,-e)), mul(v,-e));
        const b = add(add(cn, mul(u, e)), mul(v,-e));
        const cc= add(add(cn, mul(u, e)), mul(v, e));
        const dd= add(add(cn, mul(u,-e)), mul(v, e));
        quad(a,b,cc,dd,n);
      }
      // 2) Twelve edge bands (one per cube edge). For each edge: the inset
      // boundaries of the two adjacent faces give 4 corner points; a quad
      // between them with a 45°-averaged normal.
      const edges = [
        // [faceAIdx, faceBIdx, axisDir] — axisDir is the edge's running direction.
        // Bottom face (-Y) edges: with -X, +X, -Z, +Z
        [0,3,[0,0, 1]],[0,2,[0,0, 1]],[0,5,[1,0, 0]],[0,4,[1,0, 0]],
        // Top face (+Y) edges
        [1,3,[0,0, 1]],[1,2,[0,0, 1]],[1,5,[1,0, 0]],[1,4,[1,0, 0]],
        // Vertical edges (between ±X and ±Z)
        [2,4,[0,1, 0]],[2,5,[0,1, 0]],[3,4,[0,1, 0]],[3,5,[0,1, 0]],
      ];
      for (const [aI,bI,axis] of edges) {
        const [nA] = faces[aI]; const [nB] = faces[bI];
        // The edge sits at +.5 along nA AND +.5 along nB, with a .5-c offset
        // from the cube center on both. The two endpoints of the edge band
        // sit at ±(.5-c) along the running axis.
        const along = mul(axis, .5 - c);
        // Inset corner on face A (at the edge between A and B)
        const cA1 = add(add(mul(nA, .5), mul(nB, .5 - c)), along);
        const cA2 = add(add(mul(nA, .5), mul(nB, .5 - c)), mul(along,-1));
        // Corresponding corner on face B
        const cB1 = add(add(mul(nB, .5), mul(nA, .5 - c)), along);
        const cB2 = add(add(mul(nB, .5), mul(nA, .5 - c)), mul(along,-1));
        const n = norm(add(nA, nB));
        quad(cA1, cA2, cB2, cB1, n);
      }
      // 3) Eight corner caps. Each cube corner gets a single triangle bridging
      // the three adjacent edge bands. The normal is the cube-corner direction.
      for (let sx = -1; sx <= 1; sx += 2)
      for (let sy = -1; sy <= 1; sy += 2)
      for (let sz = -1; sz <= 1; sz += 2) {
        const nx = [sx, 0, 0], ny = [0, sy, 0], nz = [0, 0, sz];
        const pX = add(add(mul(nx, .5), mul(ny, .5 - c)), mul(nz, .5 - c));
        const pY = add(add(mul(ny, .5), mul(nx, .5 - c)), mul(nz, .5 - c));
        const pZ = add(add(mul(nz, .5), mul(nx, .5 - c)), mul(ny, .5 - c));
        const n = norm([sx, sy, sz]);
        // Triangle winding: order depends on the sign product to match outside
        // culling (gl.CULL_FACE BACK is enabled).
        const wind = (sx * sy * sz) > 0 ? [pX, pY, pZ] : [pX, pZ, pY];
        wind.forEach(P => d.push(...P, ...n));
      }
      return mesh(d);
    }
    function pipMesh(){let d=[],N=20,r=1,h=.18;for(let i=0;i<N;i++){let a=i/N*Math.PI*2,b=(i+1)/N*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);[[0,0,h],[ca*r,sa*r,h],[cb*r,sb*r,h]].forEach(P=>d.push(...P,0,0,1));d.push(ca*r,sa*r,h,ca,sa,0);d.push(cb*r,sb*r,h,cb,sb,0);d.push(ca*r,sa*r,0,ca,sa,0);d.push(cb*r,sb*r,h,cb,sb,0);d.push(cb*r,sb*r,0,cb,sb,0);d.push(ca*r,sa*r,0,ca,sa,0);}return mesh(d);}
    // ROUNDED is the default die geometry (W4c). CUBE is kept for the
    // perf-baseline comparison and as a fallback we could expose later.
    const CUBE=cubeMesh(), ROUNDED=roundedCubeMesh(.085), PIP=pipMesh();
    const DIE=ROUNDED;  // active geometry — swap to CUBE to A/B-test perf.
    const cam=[0,-620,390]; let vp=M();
    function resize(){
      const r=canvas.getBoundingClientRect(),D=Math.min(devicePixelRatio||1,2);
      canvas.width=Math.max(2,r.width*D);canvas.height=Math.max(2,r.height*D);
      gl.viewport(0,0,canvas.width,canvas.height);
      vp=mp(persp(Math.PI/4,canvas.width/canvas.height,10,1500),look(cam,[0,0,20],[0,0,1]));
    }
    resize();
    function drawMesh(ms,model,col){gl.bindBuffer(gl.ARRAY_BUFFER,ms.b);gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(loc.n,3,gl.FLOAT,false,24,12);gl.uniformMatrix4fv(loc.model,false,new Float32Array(model));gl.uniformMatrix4fv(loc.mvp,false,new Float32Array(mp(vp,model)));gl.uniform4fv(loc.color,new Float32Array(col));gl.uniform3fv(loc.light,new Float32Array(norm([-.25,-.55,.85])));gl.drawArrays(gl.TRIANGLES,0,ms.count);}
    // No opaque floor — the dice blend onto the scene's own backdrop. Instead each die
    // gets a soft CONTACT SHADOW on the ground plane so it still feels grounded. The
    // shadow is a flat disc at z≈0, faded with height and alpha-blended over the page.
    const DISC=(()=>{let d=[],N=28,z=.5;for(let i=0;i<N;i++){let a=i/N*Math.PI*2,b=(i+1)/N*Math.PI*2;[[0,0,z],[Math.cos(a),Math.sin(a),z],[Math.cos(b),Math.sin(b),z]].forEach(P=>d.push(...P,0,0,1));}return mesh(d);})();
    function drawShadow(dd){
      const h=Math.max(0,dd.z); const fade=Math.max(0,1-h/(dd.s*2.4));
      if(fade<=.02)return;
      let m=tr(M(),[dd.x,dd.y,.5]);            // on the floor, slightly offset toward the light
      m=sc(m,dd.curS*(.78+h*0.0018));          // shadow grows a touch as the die lifts
      m[2]*=0.0; // flatten Z (keep it a disc on the ground)
      drawMesh(DISC,m,[0,0,0,0.34*fade]);
    }
    function drawTable(){ for(const d of [...arguments[0]||[]]) drawShadow(d); }
    function drawDie(d){
      let model=tr(M(),[d.x,d.y,d.z]);model=mp(model,qm(d.q));model=sc(model,d.curS);
      drawMesh(DIE,model,dieColor(d.color));
      for(const val of [1,2,3,4,5,6]){
        const f=faceInfo[val];
        const pipCol=(d.color==='red'||d.color==='green'||d.color==='blue')?[1,1,1,1]:[.04,.04,.05,1];
        for(const pp of pipPos[val]){
          let pos=add(add(mul(f.n,.5),mul(f.u,pp[0])),mul(f.v,pp[1]));
          let q=qfromTo([0,0,1],f.n);
          let m=tr(M(),[d.x,d.y,d.z]);m=mp(m,qm(d.q));m=mp(m,tr(M(),mul(pos,d.curS)));m=mp(m,qm(q));m=sc(m,d.curS*.075);
          drawMesh(PIP,m,pipCol);
        }
      }
    }
    return {canvas,gl,resize,drawTable,drawDie,cam};
  }

  function bounds(){return{minX:-310,maxX:310,minY:-155,maxY:150};}

  function physics(dice,dt,onClack){
    const G=980,F=.985,bd=bounds();let settled=0;
    for(const d of dice){
      // preSettled dice (e.g. the 'collide' cluster members) start at full size
      // with zero velocity and are exempt from the spawn-growth grow-in. The
      // bottom-of-loop "low speed + on floor → +still" check handles their
      // settle accounting naturally; nothing extra needed.
      if(!d.preSettled && d.curS<d.s){d.curS=Math.min(d.s,d.curS+d.s*4.5*dt);d.r=d.curS*.95;}
      d.vz-=G*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;
      let w=[d.wx,d.wy,d.wz],wl=len(w);if(wl>.001)d.q=qnorm(qmul(qaxis(w,wl*dt),d.q));
      let corrX=0,corrY=0,corrZ=0,cX=0,cY=0,cZ=0;
      const I_inv=6/(d.curS*d.curS),e=.38;
      for(const lc of localCorners){
        let r=qrot(d.q,mul(lc,d.curS));let P=[d.x+r[0],d.y+r[1],d.z+r[2]];
        const vpt=()=>[d.vx+d.wy*r[2]-d.wz*r[1],d.vy+d.wz*r[0]-d.wx*r[2],d.vz+d.wx*r[1]-d.wy*r[0]];
        if(P[2]<0){corrZ+=-P[2];cZ++;let v=vpt(),vn=v[2];if(vn<0){let D=1+I_inv*(r[0]*r[0]+r[1]*r[1]),j=-(1+e)*vn/D;d.vz+=j;d.wx+=I_inv*r[1]*j;d.wy-=I_inv*r[0]*j;d.vx-=v[0]*.14;d.vy-=v[1]*.14;d.wx-=I_inv*r[2]*v[1]*.08;d.wy+=I_inv*r[2]*v[0]*.08;onClack&&onClack();}}
        if(P[0]<bd.minX){corrX+=bd.minX-P[0];cX++;let v=vpt(),vn=v[0];if(vn<0){let D=1+I_inv*(r[1]*r[1]+r[2]*r[2]),j=-(1+e)*vn/D;d.vx+=j;d.wy+=I_inv*r[2]*j;d.wz-=I_inv*r[1]*j;onClack&&onClack();}}
        if(P[0]>bd.maxX){corrX+=bd.maxX-P[0];cX++;let v=vpt(),vn=-v[0];if(vn<0){let D=1+I_inv*(r[1]*r[1]+r[2]*r[2]),j=-(1+e)*vn/D;d.vx-=j;d.wy-=I_inv*r[2]*j;d.wz+=I_inv*r[1]*j;onClack&&onClack();}}
        if(P[1]<bd.minY){corrY+=bd.minY-P[1];cY++;let v=vpt(),vn=v[1];if(vn<0){let D=1+I_inv*(r[0]*r[0]+r[2]*r[2]),j=-(1+e)*vn/D;d.vy+=j;d.wx-=I_inv*r[2]*j;d.wz+=I_inv*r[0]*j;onClack&&onClack();}}
        if(P[1]>bd.maxY){corrY+=bd.maxY-P[1];cY++;let v=vpt(),vn=-v[1];if(vn<0){let D=1+I_inv*(r[0]*r[0]+r[2]*r[2]),j=-(1+e)*vn/D;d.vy-=j;d.wx+=I_inv*r[2]*j;d.wz-=I_inv*r[0]*j;onClack&&onClack();}}
      }
      if(cZ)d.z+=corrZ/cZ;if(cX)d.x+=corrX/cX;if(cY)d.y+=corrY/cY;
      d.vx*=F;d.vy*=F;d.vz*=F;d.wx*=F*.992;d.wy*=F*.992;d.wz*=F*.992;
      let speed=Math.hypot(d.vx,d.vy,d.vz)+(Math.abs(d.wx)+Math.abs(d.wy)+Math.abs(d.wz))*8;
      if(d.z<=d.curS*.52&&speed<32)d.still+=dt;else d.still=0;
      if(d.still>.58)settled++;
    }
    for(let i=0;i<dice.length;i++)for(let j=i+1;j<dice.length;j++)collide(dice[i],dice[j],onClack);
    return settled;
  }
  function collide(a,b,onClack){
    let dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,dist=Math.hypot(dx,dy,dz);
    if(dist<1){b.x+=R(-1,1);b.y+=R(-1,1);b.z+=R(1,3);dx=b.x-a.x;dy=b.y-a.y;dz=b.z-a.z;dist=Math.hypot(dx,dy,dz)||.001;}
    let minClear=(a.curS+b.curS)*.95;
    if(dist<minClear){let ov=minClear-dist,nx=dx/dist,ny=dy/dist,nz=dz/dist;a.x-=nx*ov*.5;a.y-=ny*ov*.5;a.z-=nz*ov*.5;b.x+=nx*ov*.5;b.y+=ny*ov*.5;b.z+=nz*ov*.5;dx=b.x-a.x;dy=b.y-a.y;dz=b.z-a.z;dist=Math.hypot(dx,dy,dz)||.001;}
    if(dist>=a.r+b.r)return;
    function corners(A,B){let hB=B.curS*.5,IA=6/(A.curS*A.curS),IB=6/(B.curS*B.curS),e=.25;
      for(const lc of localCorners){let rA=qrot(A.q,mul(lc,A.curS)),P=[A.x+rA[0],A.y+rA[1],A.z+rA[2]];
        let diff=[P[0]-B.x,P[1]-B.y,P[2]-B.z],lp=qrot(qinv(B.q),diff);
        if(Math.abs(lp[0])<hB&&Math.abs(lp[1])<hB&&Math.abs(lp[2])<hB){
          let ddx=hB-Math.abs(lp[0]),ddy=hB-Math.abs(lp[1]),ddz=hB-Math.abs(lp[2]),minD=Math.min(ddx,ddy,ddz),ln=[0,0,0];
          if(minD===ddx)ln[0]=Math.sign(lp[0]);else if(minD===ddy)ln[1]=Math.sign(lp[1]);else ln[2]=Math.sign(lp[2]);
          let n=qrot(B.q,ln),rB=[P[0]-B.x,P[1]-B.y,P[2]-B.z];
          A.x+=n[0]*minD*.5;A.y+=n[1]*minD*.5;A.z+=n[2]*minD*.5;B.x-=n[0]*minD*.5;B.y-=n[1]*minD*.5;B.z-=n[2]*minD*.5;
          let vA=[A.vx+A.wy*rA[2]-A.wz*rA[1],A.vy+A.wz*rA[0]-A.wx*rA[2],A.vz+A.wx*rA[1]-A.wy*rA[0]];
          let vB=[B.vx+B.wy*rB[2]-B.wz*rB[1],B.vy+B.wz*rB[0]-B.wx*rB[2],B.vz+B.wx*rB[1]-B.wy*rB[0]];
          let rv=[vA[0]-vB[0],vA[1]-vB[1],vA[2]-vB[2]],vn=dot(rv,n);
          if(vn<0){let rxA=cross(rA,n),rxB=cross(rB,n),DA=1+IA*dot(rxA,rxA),DB=1+IB*dot(rxB,rxB),j=-(1+e)*vn/(DA+DB);
            A.vx+=j*n[0];A.vy+=j*n[1];A.vz+=j*n[2];B.vx-=j*n[0];B.vy-=j*n[1];B.vz-=j*n[2];
            let tA=mul(rxA,IA*j);A.wx+=tA[0];A.wy+=tA[1];A.wz+=tA[2];let tB=mul(rxB,IB*j);B.wx-=tB[0];B.wy-=tB[1];B.wz-=tB[2];
            onClack&&onClack();}
        }
      }
    }
    corners(a,b);corners(b,a);
  }

  function spawn(dice,d){dice.push(d);}
  function newDie(o){const t=o.s||58;return{x:o.x||0,y:o.y||0,z:o.z||120,vx:o.vx||0,vy:o.vy||0,vz:o.vz||0,q:qaxis(norm([R(-1,1),R(-1,1),R(-1,1)]),R(0,Math.PI*2)),wx:o.wx||R(-8,8),wy:o.wy||R(-8,8),wz:o.wz||R(-8,8),s:t,curS:t*.03,r:t*.95,result:o.result||1,color:o.color||'',still:0};}

  // Lay dice out facing the camera, each showing its real (predetermined) value.
  //
  // W4a fix: the previous implementation set y=-105 (much closer to the camera
  // than the settled position around y≈0), which made every dice present a
  // visible "zoom-in" right after settling — exactly the bug the user called
  // out. We now keep dice AT or VERY near their settled position. A tiny z lift
  // (z=d.curS*.55) keeps them off the floor so the camera can see the face
  // clearly; no XY shift. curS is forced to d.s so the natural size is the
  // final visible size (no growth animation on present).
  function present(scene,dice){
    dice.forEach((d,i)=>{
      const v=Math.max(1,Math.min(6,d.result|0));
      // Keep settled x/y. Only adjust z so the die clears the floor enough to
      // see its top face. Cap so two dice never visibly overlap on present.
      const minSpace = d.s * 1.6;
      const idealX = (i - (dice.length-1)/2) * minSpace;
      // Lerp from current to ideal x by a small amount so dice that ended up
      // near each other slide apart slightly instead of teleporting.
      d.x = d.x * .55 + idealX * .45;
      d.y = d.y * .85;          // pull slightly toward y=0 (visual center), no big move
      d.z = d.curS * .55;       // sit JUST above the floor (was 160 = camera-pull)
      d.vx=d.vy=d.vz=d.wx=d.wy=d.wz=0;
      d.curS=d.s;                // final size — NEVER scale up further
      const faceN=faceInfo[v].n;
      // Rotate so the result face points UP (toward +Z), not toward the camera.
      // Tiny random tilt makes it feel less rigid without making the face hard
      // to read.
      const tilt = qaxis([R(-1,1),R(-1,1),0], R(-.08,.08));
      d.q = qmul(tilt, qfromTo(faceN, [0,0,1]));
    });
  }

  // Public API — drop-in compatible with Kit.rollDice.
  function roll(container, dice, opts={}){
    dice = dice || [];
    if(!container) return Promise.resolve();
    if(!supported() || opts.animate===false){
      // No WebGL / reduced-motion: show the settled faces directly (no legacy roller).
      showStatic(container, dice, opts); return Promise.resolve();
    }
    container.innerHTML='';
    container.classList.add('kit-dice3d');
    const scene=makeScene(container);
    if(!scene){ showStatic(container, dice, opts); return Promise.resolve(); }

    // W4b — throwStyle dispatch. Each style returns the initial die spec for
    // index `i` of `n` dice. Style is fully optional; omitting `opts.throwStyle`
    // keeps the legacy `tumble` behaviour (drop-compatible with old code).
    //
    //   tumble  — default, dice arc in from off-screen with spin (legacy)
    //   cannon  — all dice shot from the left side toward the right
    //   rain    — dice trickled from above, each slightly delayed visually
    //   collide — N-1 dice settled first, last die fired at the cluster
    const style = (opts.throwStyle || 'tumble').toLowerCase();
    const sim = [];
    const n = dice.length;
    function pushTumble(i, d) {
      sim.push(newDie({
        color: d.color || '', result: Math.max(1, Math.min(6, (d.value || 1) | 0)),
        x: (i - (n - 1) / 2) * 72 + R(-12, 12), y: -130 + R(-15, 15), z: 120 + R(0, 60),
        vx: R(-110, 110) + (i - (n - 1) / 2) * 18, vy: R(150, 300), vz: R(240, 440),
        wx: R(-12, 12), wy: R(-12, 12), wz: R(-10, 10),
      }));
    }
    function pushCannon(i, d) {
      // Fire from the left wall, slight vertical fan, strong rightward velocity.
      // Each die is offset slightly in y so they don't perfectly stack at the muzzle.
      sim.push(newDie({
        color: d.color || '', result: Math.max(1, Math.min(6, (d.value || 1) | 0)),
        x: -290, y: -40 + (i - (n - 1) / 2) * 18, z: 30 + R(-8, 8),
        vx: 480 + R(0, 80),                      // strong rightward
        vy: R(-30, 30) + (i - (n - 1) / 2) * 8,  // slight fan
        vz: R(180, 320),                          // arc upward then drop
        wx: R(-6, 6), wy: R(-6, 6), wz: R(-18, 18),
      }));
    }
    function pushRain(i, d) {
      // Dice fall straight down from above, lightly scattered in X. They get a
      // tiny lateral drift so they don't all land in a line. Spread across the
      // arena so the player sees the full cascade.
      sim.push(newDie({
        color: d.color || '', result: Math.max(1, Math.min(6, (d.value || 1) | 0)),
        x: (i - (n - 1) / 2) * 84 + R(-12, 12),
        y: R(-30, 30),
        z: 240 + i * 32 + R(0, 25),               // staggered z = staggered arrival
        vx: R(-25, 25), vy: R(-20, 20), vz: R(-30, 0),
        wx: R(-10, 10), wy: R(-10, 10), wz: R(-8, 8),
      }));
    }
    // For 'collide' the bulk of the dice need to start AT rest. We mark them
    // with .preSettled and set the last die as the "shooter". The animation
    // loop notices and skips the spawn-growth + initial physics for them.
    function pushCollideClusterMember(i, d, total) {
      // Cluster center is slightly left of origin; members ring around it.
      const angle = (i / total) * Math.PI * 2;
      const radius = 28 + (i % 2) * 8;
      const die = newDie({
        color: d.color || '', result: Math.max(1, Math.min(6, (d.value || 1) | 0)),
        x: -60 + Math.cos(angle) * radius,
        y:        Math.sin(angle) * radius,
        z: 30,
        vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
      });
      die.curS = die.s;       // already at full size
      die.preSettled = true;  // skip the spawn-growth animation
      sim.push(die);
    }
    function pushCollideShooter(i, d) {
      // The last die is the shooter — fired from off-screen on the right at
      // the cluster, which sits left of center.
      sim.push(newDie({
        color: d.color || '', result: Math.max(1, Math.min(6, (d.value || 1) | 0)),
        x: 300, y: 0, z: 35,
        vx: -640,             // fast leftward
        vy: R(-15, 15),
        vz: R(180, 260),
        wx: R(-20, 20), wy: R(-20, 20), wz: R(-25, 25),
      }));
    }

    if (style === 'cannon') {
      dice.forEach((d, i) => pushCannon(i, d));
    } else if (style === 'rain') {
      dice.forEach((d, i) => pushRain(i, d));
    } else if (style === 'collide' && n >= 2) {
      // First n-1 are the resting cluster; last one is the shooter.
      for (let i = 0; i < n - 1; i++) pushCollideClusterMember(i, dice[i], n - 1);
      pushCollideShooter(n - 1, dice[n - 1]);
    } else {
      // tumble (default) — also the fallback for collide with <2 dice.
      dice.forEach((d, i) => pushTumble(i, d));
    }

    const onClack=(()=>{let last=0;return ()=>{const now=performance.now();if(now-last>45){last=now;if(typeof SFX!=='undefined'&&SFX.tap)SFX.tap();if(opts.onClack)opts.onClack();}};})();
    if(typeof SFX!=='undefined'&&SFX.draw)SFX.draw();

    return new Promise(res=>{
      let raf=0,last=0,start=performance.now(),presenting=false,done=false;
      const ro=(typeof ResizeObserver!=='undefined')?new ResizeObserver(()=>scene.resize()):null;
      if(ro)ro.observe(container);
      const maxMs=opts.duration?Math.max(1600,opts.duration*3):4200; // hard cap so we always settle
      function finish(){
        if(done)return;done=true;
        cancelAnimationFrame(raf);if(ro)ro.disconnect();
        if(typeof SFX!=='undefined'&&SFX.reveal)SFX.reveal();
        res();
      }
      function frame(t){
        if(!last)last=t;let dt=Math.min(.025,(t-last)/1000);last=t;
        if(!presenting){
          const settled=physics(sim,dt,onClack);
          if((settled===sim.length&&t-start>1200) || t-start>maxMs){ presenting=true; present(scene,sim); setTimeout(finish,520); }
        }
        const gl=scene.gl;gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        // contact shadows first, with depth-write OFF so they don't z-fight the dice
        gl.depthMask(false); scene.drawTable(sim); gl.depthMask(true);
        sim.slice().sort((a,b)=>a.y-b.y).forEach(scene.drawDie);
        raf=requestAnimationFrame(frame);
      }
      raf=requestAnimationFrame(frame);
    });
  }

  // showStatic(container, dice): a clean SETTLED readout (no box/window) — the dice
  // faces at rest, using the shared .kit-die-static markup. Used for the resting
  // display after a roll and as the no-WebGL fallback, so there is ONE dice look and
  // no legacy CSS-dice roller wired into games.
  function showStatic(container, dice, opts={}){
    if(!container) return;
    dice = dice || [];
    const size = opts.size || 42;
    const cc = {white:'white',red:'red',yellow:'yellow',green:'green',blue:'blue',r:'red',y:'yellow',g:'green',b:'blue'};
    container.classList.remove('kit-dice3d');
    container.innerHTML = dice.map(d=>{
      const c = cc[d.color]||d.color||'white';
      return `<div class="kit-die-static" style="--die-size:${size}px"><div class="kit-die ${c}"><b class="face front"><span>${d.value}</span></b><b class="face back"></b><b class="face right"></b><b class="face left"></b><b class="face top"></b><b class="face bottom"></b></div></div>`;
    }).join('');
  }

  Kit.Dice3D = { roll, supported, showStatic };
})();
