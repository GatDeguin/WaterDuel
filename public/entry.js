/** Select the local touch arena without changing authenticated QR handsets. */
export function mobileEntry({search='',touchPoints=0,coarse=false,hoverNone=false}={}){
  const view=new URLSearchParams(search).get('view');
  if(view==='desktop')return false;
  return view==='mobile'||touchPoints>0&&coarse&&hoverNone;
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
  if(mobileEntry({search:location.search,touchPoints:navigator.maxTouchPoints||0,
    coarse:window.matchMedia('(pointer: coarse)').matches,hoverNone:window.matchMedia('(hover: none)').matches})){
    const target=new URL('./mobile.html',location.href);target.search=location.search;
    target.searchParams.delete('view');location.replace(target.href);
  }else import('./game.js');
}
