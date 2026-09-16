export function surveyPageId(url){
 const value=String(url??'');
 const match=value.match(/(?:^|\/)([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:[?#].*)?$/i);
 return match?match[1].replaceAll('-','').toLowerCase():null;
}
export function validateSurveyChanges(changes){
 if(!Array.isArray(changes)||!changes.length||changes.length>200)throw Error('invalid_request');
 const ids=new Set();
 return changes.map(c=>{
  if(!c||typeof c.pageId!=='string'||!/^[a-f0-9]{32}$/.test(c.pageId)||ids.has(c.pageId)||typeof c.confirmed!=='boolean'||!Number.isSafeInteger(c.version)||c.version<0)throw Error('invalid_request');
  ids.add(c.pageId);return{pageId:c.pageId,confirmed:c.confirmed,version:c.version};
 });
}
