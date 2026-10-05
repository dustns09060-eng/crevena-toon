import { EXTERNAL_IMAGE_COUNT, EXTERNAL_IMAGE_MAX_BYTES, sortExternalImages } from "./externalImageUtils";
export async function readImageArchive(file:File):Promise<File[]> {
 if(file.size>100*1024*1024)throw new Error("ZIP은 100MB 이내로 선택해주세요.");
 const {default:JSZip}=await import("jszip");
 const zip=await JSZip.loadAsync(await file.arrayBuffer());
 const entries=Object.values(zip.files).filter(e=>!e.dir&&!e.name.startsWith("__MACOSX/")&&!e.name.split("/").pop()?.startsWith("."));
 const images=entries.filter(e=>/\.(png|jpe?g|webp)$/i.test(e.name));
 if(images.length!==EXTERNAL_IMAGE_COUNT)throw new Error(`ZIP에서 이미지 ${images.length}장을 찾았습니다. 표지 1장과 본문 10장만 넣어주세요. 프로젝트 JSON은 이미지 ZIP과 다릅니다.`);
 const names=images.map(e=>e.name.split("/").pop()!);
 if(new Set(names.map(n=>n.toLowerCase())).size!==names.length)throw new Error("이름이 같은 이미지가 있습니다. 파일명을 구분해주세요.");
 const files:File[]=[];
 for(const entry of images){
   const declared=(entry as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize;
   if(typeof declared!=="number"||declared>EXTERNAL_IMAGE_MAX_BYTES)throw new Error("압축을 푼 이미지가 장당 10MB를 초과합니다.");
   const bytes=await entry.async("uint8array");
   if(bytes.byteLength>EXTERNAL_IMAGE_MAX_BYTES)throw new Error("이미지가 장당 10MB를 초과합니다.");
   const name=entry.name.split("/").pop()!;
   const ext=name.split(".").pop()!.toLowerCase();
   files.push(new File([new Uint8Array(bytes)],name,{type:ext==="jpg"||ext==="jpeg"?"image/jpeg":`image/${ext}`}));
 }
 return sortExternalImages(files);
}
