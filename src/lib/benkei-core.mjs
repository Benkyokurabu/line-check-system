import {createHash} from 'node:crypto';
export const BENKEI_PAGE='263f0120-80a7-8049-8065-df5ca732ea9b';
export function blockText(block){
 const value=block[block.type]??{};
 const text=(value.rich_text??value.caption??[]).map(part=>{
  const label=part.plain_text??part.text?.content??'';const href=part.href??part.text?.link?.url;
  return href&&href!==label?`${label} (${href})`:label;
 }).join('');
 const url=value.url??value.external?.url;
 if(url)return `${text}${text?'\n':''}${url}`;
 if(block.type==='child_page'||block.type==='child_database')return `[参照先: ${value.title??block.type}] https://app.notion.com/p/${block.id.replaceAll('-','')}（参照先の本文はこの確認の対象外です）`;
 return text;
}
// The announcements above the first divider are separate confirmation units.
// The first callout is the progress dashboard; database views below the divider
// remain source links and are collected by the school-context pipeline separately.
export function announcementBlocks(blocks){const result=[];for(const block of blocks){if(block.type==='divider')break;if(block.id==='c8397cca-0e2f-4560-a2bd-68651df1646f')continue;if(block.type==='callout'||blockText(block).trim())result.push(block);}return result;}
export async function readBenkeiItem(root,request,{maxCalls=45}={}){
 let calls=0;const parts=[];let edited=root.last_edited_time??null;
 async function walk(block,depth){
  if(depth>12)throw new Error('benkei_source_incomplete');
  if(block.archived||block.in_trash)throw new Error('benkei_source_removed');
  const text=blockText(block);if(text.trim())parts.push(text);
  if(block.last_edited_time&&(!edited||block.last_edited_time>edited))edited=block.last_edited_time;
  if(block.has_children){let cursor;do{
   if(++calls>maxCalls)throw new Error('benkei_source_incomplete');
   const page=await request(`/blocks/${block.id}/children?page_size=100${cursor?`&start_cursor=${encodeURIComponent(cursor)}`:''}`);
   if(!Array.isArray(page.results)||page.has_more&&!page.next_cursor)throw new Error('benkei_source_incomplete');
   for(const child of page.results)await walk(child,depth+1);
   cursor=page.has_more?page.next_cursor:null;
  }while(cursor);}
 }
 await walk(root,0);const body=parts.join('\n\n').trim();if(!body||body.length>300000)throw new Error('benkei_source_incomplete');
 const title=body.split('\n')[0].slice(0,160),hash=createHash('sha256').update(body).digest('hex');
 return {sourceId:root.id,title,body,hash,editedAt:edited,url:`https://app.notion.com/p/${BENKEI_PAGE.replaceAll('-','')}#${root.id.replaceAll('-','')}`};
}
export async function readAnnouncements(request){
 const blocks=[];let cursor;let pages=0;do{
  if(++pages>10)throw new Error('benkei_source_incomplete');
  const page=await request(`/blocks/${BENKEI_PAGE}/children?page_size=100${cursor?`&start_cursor=${encodeURIComponent(cursor)}`:''}`);
  if(!Array.isArray(page.results)||page.has_more&&!page.next_cursor)throw new Error('benkei_source_incomplete');
  blocks.push(...page.results);cursor=page.has_more?page.next_cursor:null;
 }while(cursor);
 const items=[];for(const block of announcementBlocks(blocks))items.push(await readBenkeiItem(block,request));return items;
}
