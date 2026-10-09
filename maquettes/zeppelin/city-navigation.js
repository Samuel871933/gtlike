/* Géométrie partagée par les trajets du joueur et des autres capitaines. */
(function(root){
 'use strict';
 function length(points){return points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0)}
 function sample(points,t){
  let remaining=length(points)*Math.max(0,Math.min(1,t));
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
   if(!d)continue;
   if(remaining<=d||i===points.length-1){const f=Math.min(1,remaining/d);return {point:{x:a.x+dx*f,y:a.y+dy*f},dx,dy}}
   remaining-=d;
  }
  return {point:{...points[points.length-1]},dx:1,dy:0};
 }
 function create(nodes,edges){
  const neighbors=Object.fromEntries(Object.keys(nodes).map(id=>[id,[]]));
  for(const [a,b] of edges){neighbors[a].push(b);neighbors[b].push(a)}
  function path(start,end){
   const pending=new Set(Object.keys(nodes)),dist={[start]:0},previous={};
   while(pending.size){
    const u=[...pending].sort((a,b)=>(dist[a]??Infinity)-(dist[b]??Infinity))[0];
    if(!Number.isFinite(dist[u]))break;
    pending.delete(u);if(u===end)break;
    for(const v of neighbors[u]){const d=dist[u]+Math.hypot(nodes[v].x-nodes[u].x,nodes[v].y-nodes[u].y);if(d<(dist[v]??Infinity)){dist[v]=d;previous[v]=u}}
   }
   if(!Number.isFinite(dist[end]))throw Error('Voie aérienne inaccessible : '+end);
   const ids=[end];while(ids[0]!==start)ids.unshift(previous[ids[0]]);
   return ids.map(id=>({...nodes[id]}));
  }
  return {path,length,sample};
 }
 const api={create,length,sample};
 if(typeof module!=='undefined')module.exports=api;else root.CityNavigation=api;
})(typeof window==='undefined'?globalThis:window);
