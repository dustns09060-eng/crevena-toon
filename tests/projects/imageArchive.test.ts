import {expect,test} from "vitest";
import JSZip from "jszip";
import {readImageArchive} from "../../lib/projects/imageArchive";
async function archive(names:string[]){const zip=new JSZip();names.forEach(n=>zip.file(n,"sample"));return new File([await zip.generateAsync({type:"uint8array"})],"images.zip");}
test("extracts and sorts eleven images for preview without uploading",async()=>{
 const names=Array.from({length:11},(_,i)=>`${10-i}.png`);
 const files=await readImageArchive(await archive(names));expect(files).toHaveLength(11);expect(files[0].name).toBe("0.png");expect(files[10].name).toBe("10.png");
});
test("rejects wrong counts and duplicate basenames",async()=>{
 await expect(readImageArchive(await archive(["project.json"]))).rejects.toThrow("프로젝트 JSON");
 await expect(readImageArchive(await archive([...Array.from({length:10},(_,i)=>`${i}.png`),"folder/0.png"]))).rejects.toThrow("이름이 같은");
});
