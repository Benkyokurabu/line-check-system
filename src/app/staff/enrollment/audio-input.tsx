'use client';
import {useEffect,useRef,useState} from 'react';
type Part={id:number;blob:Blob;state:'waiting'|'working'|'failed'|'done';error:string};
const extension=(blob:Blob)=>({'audio/mp4':'mp4','video/mp4':'mp4','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg'}[blob.type.split(';')[0]]??'webm');
export default function AudioInput({onText,onBusy}:{onText:(text:string)=>void;onBusy:(busy:boolean)=>void}){
 const [recording,setRecording]=useState(false),[parts,setParts]=useState<Part[]>([]),[error,setError]=useState('');
 const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const stopped=useRef(true),alive=useRef(true),queue=useRef<Part[]>([]),working=useRef(false),seq=useRef(0),textCallback=useRef(onText),busyCallback=useRef(onBusy);
 useEffect(()=>{textCallback.current=onText;busyCallback.current=onBusy;});
 function refresh(){if(alive.current){setParts([...queue.current]);busyCallback.current(!stopped.current||queue.current.some(p=>p.state!=='done'));}}
 async function consume(){if(working.current)return;working.current=true;
  try{for(const part of queue.current){if(part.state==='done')continue;if(part.state==='failed')break;part.state='working';refresh();try{
   const form=new FormData();form.set('audio',part.blob,`interview-${part.id}.${extension(part.blob)}`);
   const response=await fetch('/api/staff/enrollment/audio',{method:'POST',body:form});const data=await response.json();if(!response.ok)throw Error(data.error||'音声を読み取れませんでした。');
   if(!alive.current)return;part.state='done';textCallback.current(`【録音 ${part.id}】\n${data.text}`);refresh();
  }catch(e){part.state='failed';part.error=e instanceof Error?e.message:'文字起こしを完了できませんでした。';refresh();break;}}}finally{working.current=false;}
 }
 function segment(){const active=stream.current;if(!active||stopped.current)return;
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  const rec=new MediaRecorder(active,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:24000});recorder.current=rec;const chunks:BlobPart[]=[];
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  rec.onstop=()=>{const blob=new Blob(chunks,{type:rec.mimeType});if(alive.current&&blob.size){queue.current.push({id:++seq.current,blob,state:'waiting',error:''});refresh();void consume();}if(!stopped.current)segment();};
  rec.onerror=()=>{setError('録音が停止しました。保存済みの音声は文字起こしできます。');stop();};rec.start();timer.current=setTimeout(()=>{if(rec.state==='recording')rec.stop();},60000);
 }
 function stop(){stopped.current=true;if(timer.current)clearTimeout(timer.current);const rec=recorder.current;if(rec?.state==='recording')rec.stop();else refresh();stream.current?.getTracks().forEach(t=>t.stop());setRecording(false);}
 async function start(){setError('');try{if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('このブラウザでは録音できません。音声ファイルまたは文章を入力してください。');stream.current=await navigator.mediaDevices.getUserMedia({audio:true});if(!alive.current){stream.current.getTracks().forEach(t=>t.stop());return;}stopped.current=false;setRecording(true);busyCallback.current(true);segment();}catch(e){setError(e instanceof Error?e.message:'マイクを使用できません。');}}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;stopped.current=true;if(timer.current)clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());};},[]);
 function download(p:Part){const url=URL.createObjectURL(p.blob);const a=document.createElement('a');a.href=url;a.download=`面談録音_${p.id}.${extension(p.blob)}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section aria-label="面談音声の入力"><h3>面談音声から入力する</h3><p>録音の同意を確認してから開始してください。音声は区切って文字起こしし、下の「面談の内容・補足」に追加します。</p>
 <button type="button" onClick={()=>recording?stop():void start()}>{recording?'録音を終了':'マイクで録音を開始'}</button>
 <label>音声ファイル（1件3MBまで）<input type="file" accept="audio/*,video/mp4" disabled={recording} onChange={e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>3_000_000){setError('音声ファイルは3MB以内にしてください。マイク録音は自動で区切ります。');return;}queue.current.push({id:++seq.current,blob:file,state:'waiting',error:''});refresh();void consume();e.target.value='';}}/></label>
 {recording&&<p role="status">録音中です。終了してから生徒の切替・保存をしてください。</p>}{error&&<p role="alert">{error}</p>}
 {parts.map(p=><div key={p.id}><p>音声 {p.id}：{p.state==='done'?'文字起こし済み／手入力へ引継ぎ済み':p.state==='failed'?p.error:p.state==='working'?'文字起こし中':'待機中'}</p>{p.state!=='done'&&<button type="button" onClick={()=>download(p)}>この音声を保存</button>}{p.state==='failed'&&<><button type="button" onClick={()=>{p.state='waiting';refresh();void consume();}}>文字起こしを再試行</button><button type="button" onClick={()=>{download(p);p.state='done';textCallback.current(`【音声 ${p.id} は文字起こし未完了。保存した音声を確認して内容を補ってください】`);refresh();void consume();}}>音声を保存し、手入力で続ける</button></>}</div>)}
 </section>;
}
