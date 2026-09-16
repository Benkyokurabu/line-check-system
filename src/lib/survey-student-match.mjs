export const normalizeSurveyName = value => String(value ?? '').normalize('NFKC').replace(/\s/g,'');
/** @param {{name:string,number:string,grade:string}} survey
 * @param {Array<{name:string,number:string,grade:string,teacher:string}>} students */
export function matchSurveyStudent(survey,students){
 const name=normalizeSurveyName(survey.name);
 if(!name)return null;
 const named=students.filter(s=>normalizeSurveyName(s.name)===name&&(!s.grade||s.grade===survey.grade));
 const number=String(survey.number).normalize('NFKC').trim();
 const numbered=/^[0-9]+$/.test(number)?students.filter(s=>s.number===number):[];
 // A number identifying somebody else is a conflict, never silently reassigned.
 if(numbered.length)return numbered.length===1&&named.includes(numbered[0])?numbered[0]:null;
 return named.length===1?named[0]:null;
}
