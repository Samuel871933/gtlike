const sharp=require('../../node_modules/sharp'),fs=require('fs'),path=require('path');
const root=process.env.ZEPPELIN_IMAGE_SOURCE||'/home/samuel/.codex/generated_images/01a11a68-7b98-79d1-8a98-77f6b46729de',out=path.join(__dirname,'assets/map');
async function main(){
const atlas=path.join(root,'exec-a3396ad2-0a6e-4d80-8cb8-3d85ab5b7212.png');
for(const [i,id] of ['port','alliage','condensat','ether','ruines','marche'].entries())await sharp(atlas).extract({left:i%3*512,top:Math.floor(i/3)*512,width:512,height:512}).resize(420,420).webp({quality:87,alphaQuality:100,effort:6}).toFile(path.join(out,`${id}-city.webp`));
const ship=path.join(root,'exec-06bf71b7-f18c-4669-b4f9-1375843f37e7.png');const meta=await sharp(ship).metadata();
// Chaque orientation conserve sa cellule carrée et son centre.
const ch=Math.floor(meta.height/2);
// Marges réellement générées : le profil est plus large que les vues de face.
const bounds=[0,500,950,1300,meta.width];
for(let i=0;i<8;i++)await sharp(ship).extract({left:bounds[i%4],top:Math.floor(i/4)*ch,width:bounds[i%4+1]-bounds[i%4],height:ch}).resize(256,256,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:89,alphaQuality:100,effort:6}).toFile(path.join(out,`zeppelin-angle-${i}.webp`));
await sharp(ship).resize({width:1536}).webp({quality:90,alphaQuality:100,effort:6}).toFile(path.join(out,'zeppelin-directions.webp'));
console.log('6 cités, 8 orientations et planche enregistrées');
}main().catch(e=>{console.error(e);process.exitCode=1});
