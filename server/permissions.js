const ROLES = Object.freeze({
  DEPARTMENT_HEAD: 'department_head',
  CHIEF_SCRUM: 'chief_scrum',
  SCRUM: 'scrum',
  PROJECT_LEADER: 'leader',
  ADMIN: 'admin',
});

const VALID_ROLES = Object.freeze(Object.values(ROLES));
const VIEW_ROLES = Object.freeze([...VALID_ROLES]);
const OPERATIONAL_ROLES = Object.freeze([
  ROLES.CHIEF_SCRUM,
  ROLES.SCRUM,
  ROLES.PROJECT_LEADER,
  ROLES.ADMIN,
]);

function hasRole(role, allowedRoles) {
  return allowedRoles.includes(String(role || ''));
}

function canView(role) {
  return hasRole(role, VIEW_ROLES);
}

function canOperate(role) {
  return hasRole(role, OPERATIONAL_ROLES);
}

function isAdmin(role) {
  return role === ROLES.ADMIN;
}

function canViewProject(role, project, managerEmployeeId) {
  if (!canView(role) || !project) return false;
  if (role !== ROLES.PROJECT_LEADER) return true;
  return Boolean(managerEmployeeId)
    && Number(project.leader_employee_id) === Number(managerEmployeeId);
}

function canEditProject(role, project, managerEmployeeId) {
  if (!canOperate(role) || !project) return false;
  if (role !== ROLES.PROJECT_LEADER) return true;
  return Boolean(managerEmployeeId)
    && Number(project.leader_employee_id) === Number(managerEmployeeId);
}

module.exports = {
  ROLES,
  VALID_ROLES,
  VIEW_ROLES,
  OPERATIONAL_ROLES,
  hasRole,
  canView,
  canOperate,
  isAdmin,
  canViewProject,
  canEditProject,
};
