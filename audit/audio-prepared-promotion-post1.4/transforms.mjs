import assert from 'node:assert/strict';

// Only these path/comment substitutions separate the proposed product sources
// from the three browser-tested, frozen experimental sources.
export const SOURCE_TRANSFORMS=[
  {source:'public/qa/experiments/game-audio-prepared-post1.4.js',target:'public/game-audio.js',
    sha256:'b506705d5b0d51f6024fb7a1364b691d746e33a048ac7cf1415861bd0b305ce9',rules:[
      ['// Experimental candidate only; public/game-audio.js is unchanged.',
        '// Local worker preparation preserves original audio samples and playback variants.',1],
      ["'../../audio/","'./audio/",5],
      ["'./effect-bank-preparation-post1.4.js'","'./audio/effect-bank-preparation.js'",1],
      ["'../../assets/audio/","'./assets/audio/",1]]},
  {source:'public/qa/experiments/effect-bank-preparation-post1.4.js',target:'public/audio/effect-bank-preparation.js',
    sha256:'a90bc1b1d960eda8d7ed12957aa23dceacf82af6cce59bad8fb608dcc6932698',rules:[
      ["'../../audio/synthesis.js'","'./synthesis.js'",1],
      ["'../../audio/foley-synthesis.js'","'./foley-synthesis.js'",1],
      ["'./effect-bank-worker-post1.4.js'","'./effect-bank-worker.js'",1]]},
  {source:'public/qa/experiments/effect-bank-worker-post1.4.js',target:'public/audio/effect-bank-worker.js',
    sha256:'c74b708378dfddead6536d7b1b02a44a1889cd816d058e9808d6a16a5e303091',rules:[
      ["'../../audio/synthesis.js'","'./synthesis.js'",1],
      ["'../../audio/foley-synthesis.js'","'./foley-synthesis.js'",1],
      ["'./effect-bank-preparation-post1.4.js'","'./effect-bank-preparation.js'",1]]},
];
export function transformSource(bytes,spec,reverse=false){
  let text=bytes.toString('utf8');
  const rules=reverse?[...spec.rules].reverse():spec.rules;
  for(const [original,promoted,count]of rules){
    const from=reverse?promoted:original,to=reverse?original:promoted;
    assert.equal(text.split(from).length-1,count,'Unexpected substitution count: '+spec.target+' / '+from);
    text=text.split(from).join(to);
  }
  return Buffer.from(text,'utf8');
}
