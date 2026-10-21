// Resolve against the shipped module, including static hosts in a subfolder.
export const runtimeAsset=path=>new URL('./assets/'+path,import.meta.url).href;
