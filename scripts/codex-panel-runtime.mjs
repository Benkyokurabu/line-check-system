import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function isCompleteCodexInstallation(executable, exists = fs.existsSync) {
  if (!executable || !exists(executable)) return false;
  const bin=path.dirname(executable);
  return exists(path.join(bin,'codex-code-mode-host.exe')) &&
    (exists(path.join(bin,'codex-command-runner.exe')) || exists(path.join(bin,'..','codex-resources','codex-command-runner.exe')));
}
export function codexExecutable() {
  const appData=process.env.APPDATA || path.join(os.homedir(),'AppData','Roaming');
  const localData=process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local');
  const candidates = [process.env.BENTAN_CODEX_BINARY,
    path.join(appData,'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe')];
  const installations=path.join(localData,'OpenAI','Codex','bin');
  if(fs.existsSync(installations)) {
    const versions=fs.readdirSync(installations,{withFileTypes:true}).filter(entry=>entry.isDirectory())
      .map(entry=>path.join(installations,entry.name)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    candidates.push(...versions.map(dir=>path.join(dir,'codex.exe')));
  }
  // .sandbox-bin is a single-file execution copy, not an App Server installation.
  const executable=candidates.find(value=>isCompleteCodexInstallation(value));
  if(!executable) throw new Error('Complete Codex installation with code-mode host and command runner required');
  return executable;
}
export function childEnvironment(executable) {
  const env = {};
  // Database credentials loaded by the worker must never be inherited by tools.
  for (const key of ['PATH','Path','PATHEXT','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE','HOME','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PROGRAMFILES','ProgramFiles','ProgramFiles(x86)','USERNAME','USERDOMAIN','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if(executable) {
    const bin=path.dirname(executable);
    const inherited=env.PATH || env.Path || '';
    delete env.Path;
    env.PATH=[bin,path.join(bin,'..','codex-path'),inherited].join(path.delimiter);
  }
  return env;
}
export class CodexRPC extends EventEmitter {
  constructor(cwd) {
    super(); this.sequence = 0; this.pending = new Map(); this.cwd=cwd;
    const executable=codexExecutable();
    this.child = spawn(executable, ['app-server','--listen','stdio://'], {
      cwd, env: childEnvironment(executable), windowsHide: true, stdio: ['pipe','pipe','pipe'],
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
  async verifyExecution() {
    const script="const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(p.name!=='line-check-system')throw Error('Wrong workspace');process.stdout.write('BENTAN_EXECUTION_OK');";
    const result=await this.call('command/exec',{command:[process.execPath,'-e',script],cwd:this.cwd,
      sandboxPolicy:{type:'workspaceWrite',writableRoots:[this.cwd],networkAccess:false},timeoutMs:15000});
    if(result.exitCode!==0 || result.stdout!=='BENTAN_EXECUTION_OK') throw new Error('Codex command execution preflight failed');
    return {executionReady:true};
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
