import {expect,test} from "vitest";
import {pendingImageIds} from "../../lib/projects/generationQueue";
test("resuming generation preserves unapproved candidates and approved images",()=>{
 expect(pendingImageIds(["a","b","c"],{a:{approved:{}},b:{candidate:{}}})).toEqual(["c"]);
});
