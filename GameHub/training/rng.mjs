// rng.mjs — tiny deterministic RNG helpers for repeatable training/evaluation.
// Accepts string or numeric seeds. Returns a function compatible with Math.random.

export function hashSeed(seed){
  const s=String(seed ?? '0');
  let h=2166136261 >>> 0;
  for(let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 0x9e3779b9;
}

export function makeRng(seed){
  let a = hashSeed(seed);
  const rng = function(){
    // mulberry32
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n)=>Math.floor(rng()*n);
  rng.pick = (arr)=>arr[rng.int(arr.length)];
  rng.fork = (label)=>makeRng(`${seed}:${label}`);
  return rng;
}

export function shuffleInPlace(arr, rng=Math.random){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(rng()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}
