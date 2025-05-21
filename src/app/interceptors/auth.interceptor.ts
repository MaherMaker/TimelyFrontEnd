import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { WebSocketService } from '../services/websocket.service'; // Import WebSocketService
import { Observable, throwError, BehaviorSubject, from } from 'rxjs';
import { catchError, switchMap, filter, take, finalize } from 'rxjs/operators';
import { environment } from '../../environments/environment';

let isRefreshingToken = false;
// BehaviorSubject to signal when token refresh is complete (true for success, false for failure)
let tokenRefreshed$ = new BehaviorSubject<boolean | null>(null);

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const authService = inject(AuthService);
  const webSocketService = inject(WebSocketService); // Inject WebSocketService
  const apiBaseUrl = environment.apiUrl;

  // Helper function to add token to request
  const addTokenToRequest = (request: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> => {
    // Add token if it exists, request is to our API, and not to an auth endpoint
    // (e.g., /login, /register, /refresh shouldn't typically get an Authorization Bearer token)
    if (token && request.url.startsWith(apiBaseUrl) && !request.url.includes('/auth/')) {
      return request.clone({
        headers: request.headers.set('Authorization', `Bearer ${token}`),
      });
    }
    return request;
  };

  const currentAccessToken = authService.getAccessToken();
  let authorizedRequest = addTokenToRequest(req, currentAccessToken);

  // Add X-Socket-ID header if it's an API request and socket is connected
  const socketId = webSocketService.getSocketId();
  if (socketId && authorizedRequest.url.startsWith(apiBaseUrl) && 
      ( authorizedRequest.method === 'POST' || 
        authorizedRequest.method === 'PUT' || 
        authorizedRequest.method === 'PATCH' || // Added PATCH for toggle
        authorizedRequest.method === 'DELETE'
      ) && 
      !authorizedRequest.url.includes('/auth/') && 
      ( authorizedRequest.url.includes('/alarms') || authorizedRequest.url.includes('/sync')) // Target only alarm routes
    ) {
    authorizedRequest = authorizedRequest.clone({
      headers: authorizedRequest.headers.set('X-Socket-ID', socketId),
    });
    console.log('AuthInterceptor: Added X-Socket-ID header:', socketId, 'to URL:', authorizedRequest.url);
  }

  return next(authorizedRequest).pipe(
    catchError((error: HttpErrorResponse): Observable<HttpEvent<unknown>> => {
      // Check if it's a 401, for our API, and not for the refresh token endpoint itself
      if (
        error.status === 401 &&
        req.url.startsWith(apiBaseUrl) &&
        !req.url.includes('/auth/refresh')
      ) {
        if (!isRefreshingToken) {
          isRefreshingToken = true;
          tokenRefreshed$.next(null); // Signal that refresh is in progress

          return from(authService.refreshAccessToken()).pipe( // authService.refreshAccessToken() returns a Promise
            switchMap((newAccessToken) => {
              if (newAccessToken) {
                tokenRefreshed$.next(true); // Signal successful refresh
                // Retry the original request (req, not authorizedRequest) with the new token
                return next(addTokenToRequest(req, newAccessToken));
              } else {
                // Refresh failed, no new token
                tokenRefreshed$.next(false); // Signal failed refresh
                authService.logout(); // AuthService handles navigation to login
                return throwError(() => new Error('Session expired. Please login again.'));
              }
            }),
            catchError((refreshError) => {
              tokenRefreshed$.next(false); // Signal failed refresh
              authService.logout();
              return throwError(() => refreshError); // Propagate the error from refreshAccessToken
            }),
            finalize(() => {
              isRefreshingToken = false; // Reset refreshing state
            })
          );
        } else {
          // If token is already being refreshed, wait for the refresh attempt to complete
          return tokenRefreshed$.pipe(
            filter(refreshedStatus => refreshedStatus !== null), // Wait until refresh is done (true or false)
            take(1), // Take the first signal
            switchMap(refreshedSuccessfully => {
              if (refreshedSuccessfully) {
                // Token was refreshed, get the new token and retry the request
                const newAccessTokenAfterRefresh = authService.getAccessToken();
                return next(addTokenToRequest(req, newAccessTokenAfterRefresh));
              } else {
                // The ongoing refresh failed, user should have been logged out.
                // Propagate the original 401 error for this request.
                return throwError(() => error);
              }
            })
          );
        }
      }
      // For other errors, or if conditions for refresh aren't met, just propagate the error
      return throwError(() => error);
    })
  );
};