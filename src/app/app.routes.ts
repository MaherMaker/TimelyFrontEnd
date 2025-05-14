import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard'; // Import the auth guard

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'alarms/list', // Default to main/protected page
    pathMatch: 'full'
  },
  {
    path: 'auth/login',
    loadComponent: () => import('./pages/auth/login/login.page').then(m => m.LoginPage)
  },
  {
    path: 'auth/register',
    loadComponent: () => import('./pages/auth/register/register.page').then(m => m.RegisterPage)
  },
  {
    path: 'alarms/list',
    loadComponent: () => import('./pages/alarms/list/list.page').then(m => m.ListPage),
    canActivate: [authGuard] // Protect this route
  },
  {
    path: 'alarms/detail',
    loadComponent: () => import('./pages/alarms/detail/detail.page').then(m => m.DetailPage),
    canActivate: [authGuard] // Protect this route
  },
  {
    path: 'alarms/detail/:id',
    loadComponent: () => import('./pages/alarms/detail/detail.page').then(m => m.DetailPage),
    canActivate: [authGuard] // Protect this route
  },
  {
    path: '**',
    redirectTo: 'auth/login' // Redirect unknown paths to login
  }
];
