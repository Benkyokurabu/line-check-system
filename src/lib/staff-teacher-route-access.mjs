const accessible = new Set([
  '/api/staff/session',
  '/api/staff/session/activity',
  '/api/interview-surveys/scheduling',
  '/api/staff/interview-auto-availability',
  '/api/staff/interview-availability-copy',
  '/api/staff/interview-manual-availability',
  '/api/staff/interview-materials',
  '/api/staff/interview-material-appointments',
  '/api/staff/interview-material-context',
  '/api/staff/interview-material-info',
  '/api/staff/interview-material-jobs',
  '/api/staff/interview-material-run',
  '/api/staff/interview-material-daily',
  '/api/staff/interview-material-school-library',
  '/api/staff/survey-workflow',
]);

export function teacherRouteAllowed(pathname) {
  return accessible.has(pathname);
}
