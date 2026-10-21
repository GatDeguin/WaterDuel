/** Select the local touch arena without changing authenticated QR handsets. */
export function mobileEntry({search='',touchPoints=0,coarse=false,hoverNone=false,userAgent='',platform='',mobileHint=false}={}){
  const view=new URLSearchParams(search).get('view');
  if(view==='desktop')return false;
  if(view==='mobile'||mobileHint===true||/Android|iPhone|iPad|iPod/i.test(userAgent))return true;
  // iPadOS reports a desktop Mac identity. A Windows touch screen still owns
  // the dedicated PC arena, even when its primary pointer happens to be coarse.
  if(platform==='MacIntel'&&touchPoints>1)return true;
  if(/Windows|Macintosh|X11|CrOS/i.test(userAgent))return false;
  return touchPoints>0&&coarse&&hoverNone;
}
export function entryDestination({href,mobileDocument=false,...device}){
  const source=new URL(href),mobile=mobileEntry({...device,search:source.search});
  if(mobile===mobileDocument)return null;
  const target=new URL(mobile?'./mobile.html':'./',source);
  // Keep explicit view overrides so a forced route cannot bounce back.
  target.search=source.search;return target.href;
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
  const mobileDocument=document.documentElement?.dataset?.mobileGame==='true';
  const target=entryDestination({href:location.href,mobileDocument,touchPoints:navigator.maxTouchPoints||0,
    userAgent:navigator.userAgent,platform:navigator.platform,mobileHint:navigator.userAgentData?.mobile,
    coarse:window.matchMedia('(pointer: coarse)').matches,hoverNone:window.matchMedia('(hover: none)').matches});
  if(target)location.replace(target);
  else{
    document.body.hidden=false;import('./game.js');
    if(mobileDocument)import('./controller.js');
  }
}
