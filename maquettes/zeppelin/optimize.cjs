const sharp = require('../../node_modules/sharp');
const path = require('path');
const fs = require('fs');
// Sources générées avec imagegen ; possibilité de fournir un autre répertoire.
const root = process.env.ZEPPELIN_IMAGE_SOURCE || '/home/samuel/.codex/generated_images/01a11a68-7b98-79d1-8a98-77f6b46729de';
const out = path.join(__dirname, 'assets');
const sources = {empty:'exec-b1c0411e-0b2f-4e8b-9527-b2a311abc8c0.png', assembled:'exec-67005a19-5796-43ce-8a50-8708de6fae4e.png'};
// Extraits de la scène commune : même caméra et lumière que le pont.
const crops = {
  moteurs:[1190,10,250,170],condenseur:[605,155,300,220],
  raffinerie:[865,20,255,225],pilotage:[225,560,365,235],
  cale:[635,475,380,280],atelier:[350,310,350,235],
  equipage:[885,290,330,245],hangar:[1080,145,340,220]
};
async function main(){
  fs.mkdirSync(out,{recursive:true});
  for(const [key,name] of [['empty','pont-v2.webp'],['assembled','pont-modules-v2.webp']]){
    await sharp(path.join(root,sources[key])).resize({width:1536,withoutEnlargement:true}).webp({quality:85,effort:6}).toFile(path.join(out,name));
  }
  for(const [id,[left,top,width,height]] of Object.entries(crops)){
    await sharp(path.join(root,sources.assembled)).extract({left,top,width,height}).resize({width:360,withoutEnlargement:true}).webp({quality:84,effort:6}).toFile(path.join(out,`${id}-detail-v2.webp`));
  }
  let total=0;
  for(const name of fs.readdirSync(out).filter(n=>n.includes('v2'))){const bytes=fs.statSync(path.join(out,name)).size;total+=bytes;console.log(`${name}: ${Math.round(bytes/1024)} Ko`)}
  console.log(`Total v2: ${Math.round(total/1024)} Ko`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
