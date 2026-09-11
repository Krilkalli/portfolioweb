const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROLES,
  VALID_ROLES,
  canView,
  canOperate,
  isAdmin,
  canViewProject,
  canEditProject,
  getRoleLabel,
  getRoleShortLabel,
} = require('../server/permissions');

test('the responsibility matrix exposes all five roles', () => {
  assert.deepEqual(VALID_ROLES, [
    ROLES.DEPARTMENT_HEAD,
    ROLES.CHIEF_SCRUM,
    ROLES.SCRUM,
    ROLES.PROJECT_LEADER,
    ROLES.DEPARTMENT_ADMIN,
  ]);
});

test('department head has view-only access', () => {
  assert.equal(canView(ROLES.DEPARTMENT_HEAD), true);
  assert.equal(canOperate(ROLES.DEPARTMENT_HEAD), false);
  assert.equal(isAdmin(ROLES.DEPARTMENT_HEAD), false);
});

test('chief scrum, scrum, project leader and administrator can operate', () => {
  for (const role of [ROLES.CHIEF_SCRUM, ROLES.SCRUM, ROLES.PROJECT_LEADER, ROLES.DEPARTMENT_ADMIN]) {
    assert.equal(canView(role), true);
    assert.equal(canOperate(role), true);
  }
  assert.equal(isAdmin(ROLES.DEPARTMENT_ADMIN), true);
});

test('department administrator has the new public role name', () => {
  assert.equal(getRoleLabel(ROLES.DEPARTMENT_ADMIN), 'Администратор департамента');
  assert.equal(getRoleShortLabel(ROLES.DEPARTMENT_ADMIN), 'АдминД');
});

test('project leader is limited to assigned projects', () => {
  const ownProject = { leader_employee_id: 42 };
  const otherProject = { leader_employee_id: 7 };
  assert.equal(canViewProject(ROLES.PROJECT_LEADER, ownProject, 42), true);
  assert.equal(canEditProject(ROLES.PROJECT_LEADER, ownProject, 42), true);
  assert.equal(canViewProject(ROLES.PROJECT_LEADER, otherProject, 42), false);
  assert.equal(canEditProject(ROLES.PROJECT_LEADER, otherProject, 42), false);
  assert.equal(canViewProject(ROLES.SCRUM, otherProject), true);
  assert.equal(canEditProject(ROLES.SCRUM, otherProject), true);
  assert.equal(canViewProject(ROLES.CHIEF_SCRUM, otherProject), true);
  assert.equal(canEditProject(ROLES.CHIEF_SCRUM, otherProject), true);
});
