import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, from, firstValueFrom } from 'rxjs';
import { map, tap, catchError, switchMap } from 'rxjs/operators';
import { Storage } from '@ionic/storage-angular';
import { environment } from '../../environments/environment';
import { User, AuthResponse, LoginRequest, RegisterRequest } from '../models/user.model';
import { Router } from '@angular/router';

// Constants for Storage Keys
const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const USER_KEY = 'auth_user';
const DEVICE_ID_KEY = 'auth_device_id';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private accessTokenSubject = new BehaviorSubject<string | null>(null);
  private storageInitialized = false;
  private deviceId: string | null = null;

  public currentUser$ = this.currentUserSubject.asObservable();
  public isAuthenticated$: Observable<boolean>;
  public accessToken$ = this.accessTokenSubject.asObservable();

  constructor(
    private http: HttpClient,
    private storage: Storage,
    private router: Router
  ) {
    this.isAuthenticated$ = this.currentUserSubject.pipe(map(user => !!user && !!this.accessTokenSubject.getValue()));
    this.initService();
  }

  private async initService(): Promise<void> {
    await this.initStorage();
    await this.loadDeviceId();
    await this.loadTokenAndUser();
  }

  private async initStorage(): Promise<void> {
    if (this.storageInitialized) return;
    try {
      await this.storage.create();
      this.storageInitialized = true;
      console.log('AuthService: Ionic Storage initialized.');
    } catch (error) {
      console.error('AuthService: Error initializing Ionic Storage.', error);
    }
  }

  private async loadDeviceId(): Promise<void> {
    if (!this.storageInitialized) {
      console.warn('AuthService: Storage not initialized, cannot load device ID.');
      return;
    }
    try {
      let storedDeviceId = await this.storage.get(DEVICE_ID_KEY);
      if (!storedDeviceId) {
        storedDeviceId = this.generateDeviceId();
        await this.storage.set(DEVICE_ID_KEY, storedDeviceId);
        console.log('AuthService: New Device ID generated and stored.', storedDeviceId);
      } else {
        console.log('AuthService: Device ID loaded from storage.', storedDeviceId);
      }
      this.deviceId = storedDeviceId;
    } catch (error) {
      console.error('AuthService: Error loading/setting device ID from storage.', error);
    }
  }

  private generateDeviceId(): string {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
  }

  public getDeviceId(): string | null {
    return this.deviceId;
  }

  private async loadTokenAndUser(): Promise<void> {
    if (!this.storageInitialized) {
      console.warn('AuthService: Storage not initialized, cannot load tokens.');
      return;
    }
    try {
      const accessToken = await this.storage.get(ACCESS_TOKEN_KEY);
      const user = await this.storage.get(USER_KEY);

      if (accessToken) {
        console.log('AuthService: Access Token found in storage.');
        this.accessTokenSubject.next(accessToken);
        if (user) {
          console.log('AuthService: User found in storage.', user);
          this.currentUserSubject.next(user as User);
        } else {
          console.log('AuthService: User not in storage, attempting to verify access token.');
          try {
            await this.verifyAndSetUser(accessToken);
          } catch (err) {
            console.error('AuthService: Error verifying access token during load, attempting refresh', err);
            try {
              const newAccessToken = await this.refreshAccessToken();
              if (!newAccessToken) {
                await this.logoutAction(false);
              }
            } catch (refreshErr) {
              console.error('AuthService: Refresh token also failed during load', refreshErr);
              await this.logoutAction(false);
            }
          }
        }
      } else {
        console.log('AuthService: No access token found. Checking for refresh token.');
        const refreshTokenExists = await this.storage.get(REFRESH_TOKEN_KEY);
        if (refreshTokenExists) {
          console.log('AuthService: Refresh token found, attempting to get new access token.');
          try {
            const newAccessToken = await this.refreshAccessToken();
            if (!newAccessToken) {
              await this.logoutAction(false);
            }
          } catch (err) {
            console.error('AuthService: Refresh token failed during initial load', err);
            await this.logoutAction(false);
          }
        } else {
          console.log('AuthService: No tokens found in storage.');
          this.accessTokenSubject.next(null);
          this.currentUserSubject.next(null);
        }
      }
    } catch (error) {
      console.error('AuthService: Error during loadTokenAndUser.', error);
      this.accessTokenSubject.next(null);
      this.currentUserSubject.next(null);
    }
  }

  async verifyAndSetUser(token: string): Promise<User | null> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; userId: number; username: string; email?: string; message?: string }>(`${this.apiUrl}/verify`, { token })
      );

      if (response.success && response.userId && response.username) {
        const verifiedUser: User = {
          id: response.userId,
          username: response.username,
          email: response.email || ''
        };
        this.currentUserSubject.next(verifiedUser);
        if (this.storageInitialized) await this.storage.set(USER_KEY, verifiedUser);
        console.log('AuthService: Token verified, user set.', verifiedUser);
        return verifiedUser;
      } else {
        console.warn('AuthService: Token verification failed via API.', response.message);
        return null;
      }
    } catch (error) {
      console.error('AuthService: API error during token verification:', error);
      throw error;
    }
  }

  login(credentials: Omit<LoginRequest, 'deviceId'>): Observable<AuthResponse> {
    if (!this.deviceId) {
      console.error('AuthService: Device ID not available for login.');
      return from(this.loadDeviceId().then(() => {
        if (!this.deviceId) {
          return throwError(() => new Error('Device ID could not be initialized. Please try again.'));
        }
        return this._performLogin(credentials);
      })).pipe(switchMap(obs => obs));
    }
    return this._performLogin(credentials);
  }

  private _performLogin(credentials: Omit<LoginRequest, 'deviceId'>): Observable<AuthResponse> {
    const loginPayload: LoginRequest = { ...credentials, deviceId: this.deviceId! };

    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, loginPayload).pipe(
      tap(async (response: AuthResponse) => {
        if (response.success && response.token && response.userId && response.username) {
          // Essential data for session is present
          console.log('AuthService: Login successful with essential data. Will store access token and user.', response);
          if (!this.storageInitialized) await this.initStorage();

          this.accessTokenSubject.next(response.token);
          await this.storage.set(ACCESS_TOKEN_KEY, response.token);

          const userToStore: User = {
            id: response.userId,
            username: response.username,
            email: response.email || (loginPayload.usernameOrEmail.includes('@') ? loginPayload.usernameOrEmail : '')
          };
          this.currentUserSubject.next(userToStore);
          await this.storage.set(USER_KEY, userToStore);

          if (response.refreshToken) {
            await this.storage.set(REFRESH_TOKEN_KEY, response.refreshToken);
            console.log('AuthService: Refresh token stored.');
          } else {
            console.warn('AuthService: Refresh token not provided in login response. Proceeding without it. Message:', response.message);
            // Ensure any existing refresh token is cleared if a new login doesn't provide one
            await this.storage.remove(REFRESH_TOKEN_KEY);
          }
        } else if (response.success) {
          // success: true, but token or userId or username is missing
          console.error('AuthService: Login response indicated success but missing critical token/user info.', response.message);
          throw new Error(response.message || 'Login failed: Incomplete server response from a successful call.');
        } else {
          // response.success is false
          console.error('AuthService: Login failed as per server response (success:false).', response.message);
          throw new Error(response.message || 'Login failed: Server indicated failure.');
        }
      }),
      catchError(this.handleError)
    );
  }

  register(userData: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register`, userData).pipe(
      tap(async (response: AuthResponse) => {
        if (response.success && response.token && response.refreshToken && response.userId && response.username) {
          console.log('AuthService: Registration successful', response);
          if (!this.storageInitialized) await this.initStorage();

          this.accessTokenSubject.next(response.token);
          await this.storage.set(ACCESS_TOKEN_KEY, response.token);
          await this.storage.set(REFRESH_TOKEN_KEY, response.refreshToken);

          const userToStore: User = {
            id: response.userId,
            username: response.username,
            email: userData.email
          };
          this.currentUserSubject.next(userToStore);
          await this.storage.set(USER_KEY, userToStore);
        } else {
          console.error('AuthService: Registration response missing required fields or failed.', response.message);
          throw new Error(response.message || 'Registration failed: Invalid server response.');
        }
      }),
      catchError(this.handleError)
    );
  }

  public async refreshAccessToken(): Promise<string | null> {
    if (!this.storageInitialized) {
      console.warn('AuthService: Storage not initialized, cannot refresh token.');
      return null;
    }
    const currentRefreshToken = await this.storage.get(REFRESH_TOKEN_KEY);
    if (!currentRefreshToken) {
      console.log('AuthService: No refresh token available to refresh access token.');
      return null;
    }
    if (!this.deviceId) {
      console.warn('AuthService: Device ID not available for token refresh. Attempting to load.');
      await this.loadDeviceId();
      if (!this.deviceId) {
        console.error('AuthService: Device ID could not be loaded for refresh token.');
        return null;
      }
    }

    try {
      const response = await firstValueFrom(
        this.http.post<AuthResponse>(`${this.apiUrl}/refresh`, { refreshToken: currentRefreshToken, deviceId: this.deviceId })
      );

      if (response.success && response.token) {
        console.log('AuthService: Access token refreshed successfully.');
        this.accessTokenSubject.next(response.token);
        await this.storage.set(ACCESS_TOKEN_KEY, response.token);
        if (response.refreshToken) {
          await this.storage.set(REFRESH_TOKEN_KEY, response.refreshToken);
          console.log('AuthService: Refresh token was also rotated and updated.');
        }
        if (!this.currentUserSubject.getValue() && response.token) {
          await this.verifyAndSetUser(response.token);
        }
        return response.token;
      } else {
        console.warn('AuthService: Failed to refresh access token via API.', response.message);
        await this.logoutAction(true);
        return null;
      }
    } catch (error) {
      console.error('AuthService: API error during token refresh:', error);
      await this.logoutAction(true);
      return null;
    }
  }
  private async logoutAction(navigate = true): Promise<void> {
    console.log('AuthService: Logging out.');
    if (!this.storageInitialized) {
      console.warn('AuthService: Storage not initialized, cannot properly logout.');
    } else {
      const refreshToken = await this.storage.get(REFRESH_TOKEN_KEY);
      if (refreshToken) {
        try {
          await firstValueFrom(this.http.post(`${this.apiUrl}/logout`, { refreshToken }));
          console.log('AuthService: Backend logout call successful.');
        } catch (error) {
          console.warn('AuthService: Backend logout call failed, proceeding with local cleanup.', error);
        }
      }
      await this.storage.remove(ACCESS_TOKEN_KEY);
      await this.storage.remove(REFRESH_TOKEN_KEY);
      await this.storage.remove(USER_KEY);
    }

    this.accessTokenSubject.next(null);
    this.currentUserSubject.next(null);
    console.log('AuthService: Auth data cleared from service and storage.');

    if (navigate) {
      this.router.navigate(['/auth/login']);
    }
  }

  public async logout(): Promise<void> {
    this.accessTokenSubject.next(null);
    this.currentUserSubject.next(null);
    await this.logoutAction(true);
  }

  getAccessToken(): string | null {
    return this.accessTokenSubject.getValue();
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.getValue();
  }

  async checkAuthStatus(): Promise<boolean> {
    console.log('AuthService: Checking auth status...');
    if (!this.storageInitialized) {
      console.log('AuthService: Waiting for storage to initialize for auth check...');
      await this.initService();
    }

    const accessToken = this.getAccessToken();

    if (accessToken) {
      console.log('AuthService: Access token exists, attempting to verify...');
      try {
        const user = await this.verifyAndSetUser(accessToken);
        if (user) {
          console.log('AuthService: Access token verified, user is authenticated.');
          return true;
        }
        console.log('AuthService: Access token verification failed gracefully, attempting refresh.');
      } catch (error) {
        console.log('AuthService: Access token verification threw error, attempting refresh.');
      }
      const newAccessTokenOnVerifyFail = await this.refreshAccessToken();
      return !!newAccessTokenOnVerifyFail;
    } else {
      console.log('AuthService: No access token, attempting refresh with stored refresh token.');
      const newAccessTokenOnNoToken = await this.refreshAccessToken();
      return !!newAccessTokenOnNoToken;
    }
  }

  private handleError(error: HttpErrorResponse) {
    console.error('AuthService API Error:', error);
    let errorMessage = 'An unknown error occurred!';
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else {
      if (error.error && error.error.message) {
        errorMessage = error.error.message;
      } else if (error.message) {
        errorMessage = `Error Code: ${error.status}\nMessage: ${error.message}`;
      }
    }
    return throwError(() => new Error(errorMessage));
  }
}