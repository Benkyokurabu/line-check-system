const accessible = new Set([
  '/api/staff/session',
  '/api/staff/interview-auto-availability',
  '/api/staff/interview-materials',
  '/api/staff/interview-material-jobs',
]);

export function teacherRouteAllowed(pathname) {
  return accessible.has(pathname);
}
