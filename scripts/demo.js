import { startServer } from '../src/server.js';
console.log('Local demo accounts: admin / admin-demo-2026, finance / finance-demo-2026, employee / employee-demo-2026');
console.log('Demo data is separate from normal data. Use only fictional documents.');
Object.assign(process.env, { HOST: '127.0.0.1', DATA_DIR: 'data/demo', ADMIN_PASSWORD: 'admin-demo-2026', FINANCE_PASSWORD: 'finance-demo-2026', EMPLOYEE_PASSWORD: 'employee-demo-2026' });
startServer();
