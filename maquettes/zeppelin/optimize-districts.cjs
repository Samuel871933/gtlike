const sharp=require('../../node_modules/sharp'),fs=require('fs'),path=require('path');
const root=process.env.ZEPPELIN_IMAGE_SOURCE||'/home/samuel/.codex/generated_images/01a11a68-7b98-79d1-8a98-77f6b46729de',out=path.join(__dirname,'assets/districts');
async function main(){fs.mkdirSync(out,{recursive:true});
for(const [file,names] of [['exec-d5442ff6-ac74-44f8-8b9d-458e50c9ba02.png',['market','foundry','waterworks','refinery','shipyard','customs']],['exec-a737b27a-1199-4a45-bb0b-23fdf15ea3ad.png',['bridge-a','bridge-b','plaza','skyline-a','skyline-b','lift']]]){
 for(const [i,name] of names.entries()){
 let left=i%3*512,top=i<3?0:480,width=512,height=i<3?480:544;
 // Les résidences et usines de l’atlas de décor dépassent légèrement les cellules nominales.
 if(names[0]==='bridge-a'&&i>=3){const bounds=[0,575,1145,1536];left=bounds[i%3];width=bounds[i%3+1]-left}
 await sharp(path.join(root,file)).extract({left,top,width,height}).resize(420,420,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:87,alphaQuality:100,effort:6}).toFile(path.join(out,name+'.webp'));
 }
}
let total=0;for(const f of fs.readdirSync(out)){const n=fs.statSync(path.join(out,f)).size;total+=n;console.log(f,Math.round(n/1024)+' Ko')}console.log('Total',Math.round(total/1024)+' Ko')}
main().catch(e=>{console.error(e);process.exitCode=1});
