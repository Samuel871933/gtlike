const sharp=require('../../node_modules/sharp');
const fs=require('fs');const path=require('path');
const root=process.env.ZEPPELIN_IMAGE_SOURCE||'/home/samuel/.codex/generated_images/01a11a68-7b98-79d1-8a98-77f6b46729de';
const out=path.join(__dirname,'assets/map');
async function main(){fs.mkdirSync(out,{recursive:true});
 const islands=path.join(root,'exec-3330e60d-7936-4dc4-85e2-60a14c137ab3.png');
 for(const [i,id] of ['port','alliage','condensat','ether','ruines','marche'].entries()){
 const cell=await sharp(islands).extract({left:i%3*512,top:Math.floor(i/3)*512,width:512,height:512}).png().toBuffer();
 await sharp(cell).resize(320,320).webp({quality:85,alphaQuality:100,effort:6}).toFile(path.join(out,id+'.webp'));
 }
 // Cellules fixes : aucun trim pour éviter de déplacer le centre entre frames.
 await sharp(path.join(root,'exec-b30a94f8-7a9a-4ac1-857d-e38a8dd3cb60.png')).resize(768,512).webp({quality:88,alphaQuality:100,effort:6}).toFile(path.join(out,'zeppelin-8-frames.webp'));
 await sharp(path.join(root,'exec-e3687874-8b5f-42c3-9b81-5c0cd4b78426.png')).resize(1536,1024).webp({quality:80,effort:6}).toFile(path.join(out,'ciel.webp'));
 let total=0;for(const n of fs.readdirSync(out)){const size=fs.statSync(path.join(out,n)).size;total+=size;console.log(n,Math.round(size/1024)+' Ko')}console.log('Total',Math.round(total/1024)+' Ko');
}main().catch(e=>{console.error(e);process.exitCode=1});
