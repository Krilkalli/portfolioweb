const ROLES = Object.freeze({
  DEPARTMENT_HEAD: 'department_head',
  CHIEF_SCRUM: 'chief_scrum',
  SCRUM: 'scrum',
  PROJECT_LEADER: 'leader',
  DEPARTMENT_ADMIN: 'admin',
});

const ROLE_LABELS = Object.freeze({
  [ROLES.DEPARTMENT_HEAD]: 'Руководитель департамента',
  [ROLES.CHIEF_SCRUM]: 'Главный скрам-мастер',
  [ROLES.SCRUM]: 'Скрам-мастер',
  [ROLES.PROJECT_LEADER]: 'Руководитель проекта',
  [ROLES.DEPARTMENT_ADMIN]: 'Администратор департамента',
});

const ROLE_SHORT_LABELS = Object.freeze({
  [ROLES.DEPARTMENT_HEAD]: 'РД',
  [ROLES.CHIEF_SCRUM]: 'ГСМ',
  [ROLES.SCRUM]: 'СМ',
  [ROLES.PROJECT_LEADER]: 'РП',
  [ROLES.DEPARTMENT_ADMIN]: 'АдминД',
});

const VALID_ROLES = Object.freeze(Object.values(ROLES));
const VIEW_ROLES = Object.freeze([...VALID_ROLES]);
const OPERATIONAL_ROLES = Object.freeze([
  ROLES.CHIEF_SCRUM,
  ROLES.SCRUM,
  ROLES.PROJECT_LEADER,
  ROLES.DEPARTMENT_ADMIN,
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
  return role === ROLES.DEPARTMENT_ADMIN;
}

function getRoleLabel(role) {
  return ROLE_LABELS[role] || 'Пользователь';
}

function getRoleShortLabel(role) {
  return ROLE_SHORT_LABELS[role] || '—';
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
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  VALID_ROLES,
  VIEW_ROLES,
  OPERATIONAL_ROLES,
  hasRole,
  canView,
  canOperate,
  isAdmin,
  getRoleLabel,
  getRoleShortLabel,
  canViewProject,
  canEditProject,
};
