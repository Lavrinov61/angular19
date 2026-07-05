import { EMPLOYEE_ROUTES } from './employee.routes';

describe('EMPLOYEE_ROUTES', () => {
  it('exposes the knowledge base page for employee instructions', () => {
    const shellRoute = EMPLOYEE_ROUTES.find(route => route.path === '');
    const childRoutes = shellRoute?.children ?? [];

    expect(childRoutes.some(route => route.path === 'knowledge')).toBe(true);
    expect(childRoutes.some(route => route.path === 'knowledge/:slug')).toBe(true);
  });
});
