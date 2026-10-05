export function pendingImageIds(ids:string[],images:Record<string,{approved?:unknown;candidate?:unknown}>):string[]{
 return ids.filter(id=>!images[id]?.approved&&!images[id]?.candidate);
}
