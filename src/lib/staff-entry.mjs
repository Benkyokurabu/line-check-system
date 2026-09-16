import {createHash} from 'node:crypto';
import {StaffAuthError,completeStaffLogin} from './staff-auth-core.mjs';
export async function loginStaffEntry({identityClient,dataClient,key}){
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))throw new StaffAuthError('invalid_credentials');
 const keyHash=createHash('sha256').update(key).digest('hex');
 const {data:target,error}=await dataClient.rpc('staff_entry_target',{p_key_hash:keyHash});
 if(error)throw new StaffAuthError('auth_unavailable',503);
 if(target?.limited)throw new StaffAuthError('try_later',429);
 if(!target?.email||!target.authUserId||!['KUDO','KINJO'].includes(target.staffCode))throw new StaffAuthError('invalid_credentials');
 // Generate the provider proof on the server; this does not send email.
 const {data:generated,error:generateError}=await identityClient.auth.admin.generateLink({type:'magiclink',email:target.email});
 if(generateError||generated?.user?.id!==target.authUserId||!generated.properties?.hashed_token)throw new StaffAuthError('auth_unavailable',503);
 const {data,error:verifyError}=await identityClient.auth.verifyOtp({type:'email',token_hash:generated.properties.hashed_token});
 if(verifyError||!data?.session||data.user?.id!==target.authUserId)throw new StaffAuthError('auth_unavailable',503);
 return completeStaffLogin({identityClient,dataClient,session:data.session,authUserId:target.authUserId,staffCode:target.staffCode});
}
export function staffEntryDestination(value,code){
 const destinations={interviews:'/staff/interviews',study:'/self-study-room/trial',reservations:'/reservations/trial',interviewTrial:'/reservations/trial'};
 const target=Object.hasOwn(destinations,value)?value:'interviews';
 return `${destinations[target]}?staff=${encodeURIComponent(code)}${target==='interviewTrial'?'&kind=interview':''}`;
}
