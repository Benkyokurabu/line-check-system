import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function codexExecutable() {
  const candidates = [process.env.BENTAN_CODEX_BINARY,
    path.join(os.homedir(), '.codex', '.sandbox-bin', 'codex.exe'),
    path.join(process.env.APPDATA || '', 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe')];
  return candidates.find(value => value && fs.existsSync(value)) || 'codex';
}
export function childEnvironment() {
  const env = {};
  // Database credentials loaded by the worker must never be inherited by tools.
  for (const key of ['PATH','Path','PATHEXT','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','HOME','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PROGRAMFILES','ProgramFiles','ProgramFiles(x86)','USERNAME','USERDOMAIN','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}
export class CodexRPC extends EventEmitter {
  constructor(cwd) {
    super(); this.sequence = 0; this.pending = new Map();
    this.child = spawn(codexExecutable(), ['app-server','--listen','stdio://'], {
      cwd, env: childEnvironment(), windowsHide: true, stdio: ['pipe','pipe','pipe'],
    });
    // Do not copy raw stderr (paths, tool output, and credentials) into application logs.
    this.child.stderr.resume();
    this.lines = createInterface({input:this.child.stdout});
    this.lines.on('line', line => {
      let value; try { value=JSON.parse(line); } catch { return; }
      if (value.method) this.emit('message',value);
      else {
        const pending=this.pending.get(value.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(value.id);
        if (value.error) pending.reject(new Error(`Codex RPC ${pending.method} failed (${value.error.code})`));
        else pending.resolve(value.result);
      }
    });
    const fail = () => { for (const request of this.pending.values()) {clearTimeout(request.timer);request.reject(new Error('Codex disconnected'));} this.pending.clear(); this.emit('disconnected'); };
    this.child.on('error',fail); this.child.on('exit',fail);
  }
  send(value) { if (!this.child.stdin.writable) throw new Error('Codex disconnected'); this.child.stdin.write(JSON.stringify(value)+'\n'); }
  call(method,params={}) {
    const id=++this.sequence;
    return new Promise((resolve,reject) => {
      const timer=setTimeout(() => {this.pending.delete(id);reject(new Error(`Codex RPC ${method} timed out`));},60000);
      this.pending.set(id,{resolve,reject,timer,method});
      try {this.send({id,method,params});} catch(error) {clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async initialize() {
    await this.call('initialize',{clientInfo:{name:'bentan_in_page',title:'勉たん内Codex',version:'1.0.0'}});
    this.send({method:'initialized',params:{}});
    const account=await this.call('account/read',{refreshToken:false});
    if (!account.account || account.account.type!=='chatgpt') throw new Error('ChatGPT login required');
    return {authenticated:true,type:account.account.type};
  }
  close() {
    if(this.closed) return; this.closed=true;
    this.child.stdin.end();
    // Stop descendants too: an abandoned shell must not continue changing files.
    if(process.platform==='win32' && this.child.pid && this.child.exitCode===null)
      spawnSync('taskkill',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});
    else this.child.kill();
    this.lines.close();
  }
}
