import { inject } from '@angular/core';
import { Router, CanActivateFn, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { from, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  console.log(`%cAuthGuard: Activated for route: ${state.url}`, 'color: blue; font-weight: bold;');

  return from(authService.checkAuthStatus()).pipe(
    tap(isAuthenticated => {
      console.log(`%cAuthGuard: checkAuthStatus() result for ${state.url}: ${isAuthenticated}`, 'color: blue;');
    }),
    map(isAuthenticated => {
      if (isAuthenticated) {
        console.log(`%cAuthGuard: User IS authenticated. Allowing navigation to ${state.url}.`, 'color: green;');
        return true;
      } else {
        console.warn(`%cAuthGuard: User IS NOT authenticated. Redirecting from ${state.url} to /auth/login.`, 'color: orange;');
        router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
        return false;
      }
    }),
    catchError((error) => {
      console.error(`%cAuthGuard: Error during checkAuthStatus() for ${state.url}. Redirecting to /auth/login.`, 'color: red;', error);
      router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
      return of(false);
    })
  );
};