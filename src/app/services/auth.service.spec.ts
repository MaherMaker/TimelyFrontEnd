import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Storage } from '@ionic/storage-angular';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { AuthResponse, User } from '../models/user.model';
import { of, throwError } from 'rxjs';

// Constants for Storage Keys
const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const USER_KEY = 'auth_user';
const DEVICE_ID_KEY = 'auth_device_id';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let storageSpy: jasmine.SpyObj<Storage>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    const stSpy = jasmine.createSpyObj('Storage', ['create', 'get', 'set', 'remove']);
    const rtSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: Storage, useValue: stSpy },
        { provide: Router, useValue: rtSpy },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    storageSpy = TestBed.inject(Storage) as jasmine.SpyObj<Storage>;
    routerSpy = TestBed.inject(Router) as jasmine.SpyObj<Router>;

    // Default storage mocks
    storageSpy.create.and.returnValue(Promise.resolve(storageSpy)); // Simulate storage.create() returning the storage instance
    storageSpy.get.and.returnValue(Promise.resolve(null)); // Default to no items in storage
    storageSpy.set.and.returnValue(Promise.resolve());
    storageSpy.remove.and.returnValue(Promise.resolve());

    // Spy on console messages
    spyOn(console, 'log').and.callThrough();
    spyOn(console, 'warn').and.callThrough();
    spyOn(console, 'error').and.callThrough();
  });

  afterEach(() => {
    httpMock.verify(); // Make sure that there are no outstanding requests
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('initial state should have null user and token, and isAuthenticated$ should be false', (done) => {
    expect(service.getCurrentUser()).toBeNull();
    expect(service.getAccessToken()).toBeNull();
    service.isAuthenticated$.subscribe(isAuth => {
      expect(isAuth).toBeFalse();
      done();
    });
  });

  describe('initService and storage initialization', () => {
    it('should call storage.create on initialization', fakeAsync(() => {
      // Service is initialized in beforeEach, which calls initService
      // We need to wait for promises within initService to resolve
      tick(); // Allow promises in initService like initStorage to resolve
      expect(storageSpy.create).toHaveBeenCalled();
    }));

    it('should set storageInitialized to true after storage.create', fakeAsync(() => {
      tick(); // for initStorage
      // Access private member for testing, not ideal but necessary here
      expect((service as any).storageInitialized).toBeTrue();
    }));

    it('should load device ID on initialization', fakeAsync(() => {
      spyOn((service as any), 'loadDeviceId').and.callThrough();
      storageSpy.get.withArgs(DEVICE_ID_KEY).and.returnValue(Promise.resolve('existing-device-id'));
      
      // Re-initialize or manually trigger parts of init
      (service as any).storageInitialized = false; // Reset for initStorage
      service['initService'](); // Call initService again or a more specific method
      tick(); // for initStorage, loadDeviceId promises

      expect((service as any).loadDeviceId).toHaveBeenCalled();
      tick(); // for the get call within loadDeviceId
      expect(storageSpy.get).toHaveBeenCalledWith(DEVICE_ID_KEY);
      expect(service.getDeviceId()).toBe('existing-device-id');
    }));

    it('should generate and store a new device ID if none exists', fakeAsync(() => {
      storageSpy.get.withArgs(DEVICE_ID_KEY).and.returnValue(Promise.resolve(null));
      spyOn((service as any), 'generateDeviceId').and.callThrough().and.returnValue('new-device-id');
      
      (service as any).storageInitialized = false;
      (service as any).deviceId = null;
      service['initService']();
      tick(); // initStorage, loadDeviceId, storage.get, storage.set

      expect((service as any).generateDeviceId).toHaveBeenCalled();
      expect(storageSpy.set).toHaveBeenCalledWith(DEVICE_ID_KEY, 'new-device-id');
      expect(service.getDeviceId()).toBe('new-device-id');
    }));
  });
  
  describe('loadTokenAndUser', () => {
    it('should do nothing if storage is not initialized', fakeAsync(() => {
      (service as any).storageInitialized = false;
      spyOn((service as any), 'verifyAndSetUser');
      spyOn(service, 'refreshAccessToken');
      (service as any).loadTokenAndUser();
      tick();
      expect(storageSpy.get).not.toHaveBeenCalled();
      expect((service as any).verifyAndSetUser).not.toHaveBeenCalled();
      expect(service.refreshAccessToken).not.toHaveBeenCalled();
    }));

    it('should set user and token if both are in storage and token is valid (mocked verify)', fakeAsync(() => {
      const mockUser: User = { id: 1, username: 'testuser', email: 'test@test.com' };
      const mockToken = 'valid-access-token';
      storageSpy.get.withArgs(ACCESS_TOKEN_KEY).and.returnValue(Promise.resolve(mockToken));
      storageSpy.get.withArgs(USER_KEY).and.returnValue(Promise.resolve(mockUser));
      
      (service as any).storageInitialized = true; // Ensure storage is marked as initialized
      (service as any).loadTokenAndUser();
      tick(); // for storage.get calls

      expect(service.getCurrentUser()).toEqual(mockUser);
      expect(service.getAccessToken()).toEqual(mockToken);
      service.isAuthenticated$.subscribe(isAuth => expect(isAuth).toBeTrue());
      tick();
    }));

    it('should verify token and set user if token is in storage but user is not', fakeAsync(() => {
      const mockToken = 'valid-access-token-needs-verify';
      const verifiedUser: User = { id: 2, username: 'verifiedUser', email: 'verify@test.com' };
      storageSpy.get.withArgs(ACCESS_TOKEN_KEY).and.returnValue(Promise.resolve(mockToken));
      storageSpy.get.withArgs(USER_KEY).and.returnValue(Promise.resolve(null)); // No user in storage
      
      spyOn((service as any), 'verifyAndSetUser').and.returnValue(Promise.resolve(verifiedUser));

      (service as any).storageInitialized = true;
      (service as any).loadTokenAndUser();
      tick(); // storage.get, verifyAndSetUser

      expect((service as any).verifyAndSetUser).toHaveBeenCalledWith(mockToken);
      expect(service.getCurrentUser()).toEqual(verifiedUser);
      expect(service.getAccessToken()).toEqual(mockToken);
    }));

    it('should attempt to refresh token if access token verification fails', fakeAsync(() => {
      const mockToken = 'invalid-access-token';
      storageSpy.get.withArgs(ACCESS_TOKEN_KEY).and.returnValue(Promise.resolve(mockToken));
      storageSpy.get.withArgs(USER_KEY).and.returnValue(Promise.resolve(null));
      
      spyOn((service as any), 'verifyAndSetUser').and.returnValue(Promise.reject('Verification failed'));
      spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve('new-refreshed-token'));
      // verifyAndSetUser will be called again by refreshAccessToken if successful
      (service as any).verifyAndSetUser.and.callThrough(); // Reset to actual or a new spy for the second call

      const refreshedUser: User = { id: 3, username: 'refreshedUser', email: 'refresh@test.com' };
      // Mock the second call to verifyAndSetUser that happens after successful refresh
      let verifyCallCount = 0;
      (service as any).verifyAndSetUser = jasmine.createSpy().and.callFake((tokenArg: string) => {
        verifyCallCount++;
        if (verifyCallCount === 1 && tokenArg === mockToken) { // First call for the original token
          return Promise.reject('Verification failed');
        }
        if (verifyCallCount === 2 && tokenArg === 'new-refreshed-token') { // Second call for the refreshed token
          (service as any).currentUserSubject.next(refreshedUser); // Simulate user being set
          return Promise.resolve(refreshedUser);
        }
        return Promise.reject('Unexpected call to verifyAndSetUser');
      });


      (service as any).storageInitialized = true;
      (service as any).loadTokenAndUser();
      tick(); // storage.get, first verifyAndSetUser, refreshAccessToken, second verifyAndSetUser

      expect(service.refreshAccessToken).toHaveBeenCalled();
      expect(service.getAccessToken()).toBe('new-refreshed-token');
      expect(service.getCurrentUser()).toEqual(refreshedUser);
    }));

     it('should logout if access token verification and refresh token both fail', fakeAsync(() => {
      const mockToken = 'expired-token';
      storageSpy.get.withArgs(ACCESS_TOKEN_KEY).and.returnValue(Promise.resolve(mockToken));
      storageSpy.get.withArgs(USER_KEY).and.returnValue(Promise.resolve(null));

      spyOn((service as any), 'verifyAndSetUser').and.returnValue(Promise.reject('Verification failed'));
      spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve(null)); // Refresh fails
      spyOn((service as any), 'logoutAction').and.callThrough();

      (service as any).storageInitialized = true;
      (service as any).loadTokenAndUser();
      tick(); // Promises for get, verify, refresh, logout

      expect((service as any).logoutAction).toHaveBeenCalledWith(false); // Should logout without navigation
    }));

    it('should attempt to refresh token if no access token but refresh token exists', fakeAsync(() => {
      storageSpy.get.withArgs(ACCESS_TOKEN_KEY).and.returnValue(Promise.resolve(null));
      storageSpy.get.withArgs(REFRESH_TOKEN_KEY).and.returnValue(Promise.resolve('valid-refresh-token'));
      
      spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve('new-token-from-refresh'));
      const refreshedUser: User = { id: 4, username: 'userFromRefresh', email: 'fromrefresh@test.com' };
      
      // Mock verifyAndSetUser which is called after successful refresh
      spyOn((service as any), 'verifyAndSetUser').and.callFake((tokenArg: string) => {
        if (tokenArg === 'new-token-from-refresh') {
          (service as any).currentUserSubject.next(refreshedUser);
          return Promise.resolve(refreshedUser);
        }
        return Promise.reject('verifyAndSetUser called with unexpected token');
      });

      (service as any).storageInitialized = true;
      (service as any).loadTokenAndUser();
      tick(); // storage.get, refreshAccessToken, verifyAndSetUser

      expect(service.refreshAccessToken).toHaveBeenCalled();
      expect(service.getAccessToken()).toBe('new-token-from-refresh');
      expect(service.getCurrentUser()).toEqual(refreshedUser);
    }));

    it('should logout if no access token and refresh token fails', fakeAsync(() => {
      storageSpy.get.withArgs(ACCESS_TOKEN_KEY).and.returnValue(Promise.resolve(null));
      storageSpy.get.withArgs(REFRESH_TOKEN_KEY).and.returnValue(Promise.resolve('invalid-refresh-token'));
      
      spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve(null)); // Refresh fails
      spyOn((service as any), 'logoutAction').and.callThrough();

      (service as any).storageInitialized = true;
      (service as any).loadTokenAndUser();
      tick(); // storage.get, refreshAccessToken, logoutAction

      expect((service as any).logoutAction).toHaveBeenCalledWith(false);
    }));

    it('should have null user and token if no tokens are found in storage', fakeAsync(() => {
      storageSpy.get.withArgs(ACCESS_TOKEN_KEY).and.returnValue(Promise.resolve(null));
      storageSpy.get.withArgs(REFRESH_TOKEN_KEY).and.returnValue(Promise.resolve(null));
      storageSpy.get.withArgs(USER_KEY).and.returnValue(Promise.resolve(null));

      (service as any).storageInitialized = true;
      (service as any).loadTokenAndUser();
      tick(); // storage.get calls

      expect(service.getCurrentUser()).toBeNull();
      expect(service.getAccessToken()).toBeNull();
      service.isAuthenticated$.subscribe(isAuth => expect(isAuth).toBeFalse());
      tick();
    }));
  });

  describe('verifyAndSetUser', () => {
    const verifyUrl = `${environment.apiUrl}/auth/verify`;

    it('should verify token, set user, and store user on success', fakeAsync(() => {
      const token = 'test-token';
      const apiResponse = { success: true, userId: 1, username: 'verified', email: 'verified@test.com' };
      const expectedUser: User = { id: 1, username: 'verified', email: 'verified@test.com' };
      (service as any).storageInitialized = true; // Ensure storage is ready

      let resultUser: User | null = null;
      (service as any).verifyAndSetUser(token).then((res: User | null) => resultUser = res);
      
      const req = httpMock.expectOne(verifyUrl);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ token });
      req.flush(apiResponse);
      tick(); // for http call and storage.set

      expect(resultUser).toEqual(expectedUser as any); // Cast to any to satisfy Jasmine's Expected<User | null>
      expect(service.getCurrentUser()).toEqual(expectedUser as any); // Cast to any
      expect(storageSpy.set).toHaveBeenCalledWith(USER_KEY, expectedUser);
    }));

    it('should return null and not set user if API verification fails (success: false)', fakeAsync(() => {
      const token = 'test-token';
      const apiResponse = { success: false, message: 'Invalid token' };
      (service as any).storageInitialized = true;

      let resultUser: User | null = null;
      (service as any).verifyAndSetUser(token).then((res: User | null) => resultUser = res);

      const req = httpMock.expectOne(verifyUrl);
      req.flush(apiResponse);
      tick();

      expect(resultUser).toBeNull();
      expect(service.getCurrentUser()).toBeNull(); // Assuming it was null before
      expect(storageSpy.set).not.toHaveBeenCalledWith(USER_KEY, jasmine.any(Object));
    }));

    it('should throw error and not set user if API call fails', fakeAsync(() => {
      const token = 'test-token';
      (service as any).storageInitialized = true;

      let errorThrown: any;
      (service as any).verifyAndSetUser(token).catch((err: any) => errorThrown = err);

      const req = httpMock.expectOne(verifyUrl);
      req.flush('API Error', { status: 500, statusText: 'Server Error' });
      tick();

      expect(errorThrown).toBeTruthy();
      expect(service.getCurrentUser()).toBeNull();
      expect(storageSpy.set).not.toHaveBeenCalledWith(USER_KEY, jasmine.any(Object));
    }));
  });

  describe('login', () => {
    const loginUrl = `${environment.apiUrl}/auth/login`;
    const loginCredentials = { usernameOrEmail: 'test@test.com', password: 'password123' };
    const mockAuthResponse: AuthResponse = {
      success: true,
      token: 'new-access-token',
      refreshToken: 'new-refresh-token',
      userId: 1,
      username: 'testuser',
      message: 'Login successful'
    };
    const expectedUser: User = { id: 1, username: 'testuser', email: 'test@test.com' };

    beforeEach(() => {
      // Ensure deviceId is set for most login tests
      (service as any).deviceId = 'test-device-id';
      (service as any).storageInitialized = true;
    });

    it('should login successfully, store tokens and user, and update subjects', fakeAsync(() => {
      service.login(loginCredentials).subscribe(response => {
        expect(response).toEqual(mockAuthResponse);
      });

      const req = httpMock.expectOne(loginUrl);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ ...loginCredentials, deviceId: 'test-device-id' });
      req.flush(mockAuthResponse);
      tick(); // for http call and async operations within tap

      expect(storageSpy.set).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, mockAuthResponse.token);
      expect(storageSpy.set).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, mockAuthResponse.refreshToken);
      expect(storageSpy.set).toHaveBeenCalledWith(USER_KEY, expectedUser);
      expect(service.getCurrentUser()).toEqual(expectedUser as any); // Cast to any
      expect(service.getAccessToken()).toBe(mockAuthResponse.token!); // Added non-null assertion
      service.isAuthenticated$.subscribe(isAuth => expect(isAuth).toBeTrue());
      tick();
    }));

    it('should attempt to load deviceId if not available, then login', fakeAsync(() => {
      (service as any).deviceId = null;
      spyOn((service as any), 'loadDeviceId').and.callFake(() => {
        (service as any).deviceId = 'loaded-device-id';
        return Promise.resolve();
      });

      service.login(loginCredentials).subscribe();
      tick(); // for loadDeviceId promise

      const req = httpMock.expectOne(loginUrl);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ ...loginCredentials, deviceId: 'loaded-device-id' });
      req.flush(mockAuthResponse);
      tick();

      expect((service as any).loadDeviceId).toHaveBeenCalled();
      expect(service.getAccessToken()).toBe(mockAuthResponse.token!); // Added non-null assertion
    }));

    it('should throw error if deviceId cannot be initialized during login', fakeAsync(() => {
      (service as any).deviceId = null;
      spyOn((service as any), 'loadDeviceId').and.callFake(() => {
        (service as any).deviceId = null; // Simulate failure to load
        return Promise.resolve();
      });

      let errorThrown: any;
      service.login(loginCredentials).subscribe({
        error: (err) => errorThrown = err
      });
      tick(); // for loadDeviceId and subsequent error

      expect((service as any).loadDeviceId).toHaveBeenCalled();
      expect(errorThrown).toBeTruthy();
      expect(errorThrown.message).toContain('Device ID could not be initialized');
      httpMock.expectNone(loginUrl);
    }));

    it('should throw error if login API response is not successful', fakeAsync(() => {
      const failResponse: AuthResponse = { success: false, message: 'Invalid credentials' };
      let errorThrown: any;

      service.login(loginCredentials).subscribe({
        error: (err) => errorThrown = err
      });

      const req = httpMock.expectOne(loginUrl);
      req.flush(failResponse);
      tick();

      expect(errorThrown).toBeTruthy();
      expect(errorThrown.message).toBe(failResponse.message);
      expect(storageSpy.set).not.toHaveBeenCalledWith(ACCESS_TOKEN_KEY, jasmine.any(String));
      expect(service.getCurrentUser()).toBeNull();
    }));

    it('should propagate HTTP error from login API call', fakeAsync(() => {
      let errorThrown: any;
      service.login(loginCredentials).subscribe({ 
        error: (err) => errorThrown = err 
      });

      const req = httpMock.expectOne(loginUrl);
      req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
      tick();

      expect(errorThrown).toBeTruthy();
      // The exact error message depends on the handleError implementation
      // For now, just check that an error was indeed thrown.
      expect(storageSpy.set).not.toHaveBeenCalledWith(ACCESS_TOKEN_KEY, jasmine.any(String));
    }));
  });

  describe('register', () => {
    const registerUrl = `${environment.apiUrl}/auth/register`;
    const registerData = { username: 'newuser', email: 'new@test.com', password: 'password123' };
    const mockAuthResponse: AuthResponse = {
      success: true,
      token: 'register-access-token',
      refreshToken: 'register-refresh-token',
      userId: 2,
      username: 'newuser',
      message: 'Registration successful'
    };
    const expectedUser: User = { id: 2, username: 'newuser', email: 'new@test.com' };

    beforeEach(() => {
      (service as any).storageInitialized = true;
    });

    it('should register successfully, store tokens and user, and update subjects', fakeAsync(() => {
      service.register(registerData).subscribe(response => {
        expect(response).toEqual(mockAuthResponse);
      });

      const req = httpMock.expectOne(registerUrl);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(registerData);
      req.flush(mockAuthResponse);
      tick(); // for http call and async operations within tap

      expect(storageSpy.set).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, mockAuthResponse.token);
      expect(storageSpy.set).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, mockAuthResponse.refreshToken);
      expect(storageSpy.set).toHaveBeenCalledWith(USER_KEY, expectedUser);
      expect(service.getCurrentUser()).toEqual(expectedUser as any); // Cast to any
      expect(service.getAccessToken()).toBe(mockAuthResponse.token!); // Added non-null assertion
      service.isAuthenticated$.subscribe(isAuth => expect(isAuth).toBeTrue());
      tick();
    }));

    it('should throw error if register API response is not successful', fakeAsync(() => {
      const failResponse: AuthResponse = { success: false, message: 'Email already exists' };
      let errorThrown: any;

      service.register(registerData).subscribe({
        error: (err) => errorThrown = err
      });

      const req = httpMock.expectOne(registerUrl);
      req.flush(failResponse);
      tick();

      expect(errorThrown).toBeTruthy();
      expect(errorThrown.message).toBe(failResponse.message);
      expect(storageSpy.set).not.toHaveBeenCalledWith(ACCESS_TOKEN_KEY, jasmine.any(String));
      expect(service.getCurrentUser()).toBeNull();
    }));

    it('should propagate HTTP error from register API call', fakeAsync(() => {
      let errorThrown: any;
      service.register(registerData).subscribe({ 
        error: (err) => errorThrown = err 
      });

      const req = httpMock.expectOne(registerUrl);
      req.flush('Server error', { status: 500, statusText: 'Internal Server Error' });
      tick();

      expect(errorThrown).toBeTruthy();
      expect(storageSpy.set).not.toHaveBeenCalledWith(ACCESS_TOKEN_KEY, jasmine.any(String));
    }));
  });

  describe('refreshAccessToken', () => {
    const refreshUrl = `${environment.apiUrl}/auth/refresh`;
    const mockOldRefreshToken = 'old-refresh-token';
    const mockNewAuthResponse: AuthResponse = {
      success: true,
      token: 'refreshed-access-token',
      refreshToken: 'new-rotated-refresh-token',
      message: 'Token refreshed'
      // userId and username might not be part of refresh response, depends on API
    };

    beforeEach(() => {
      (service as any).storageInitialized = true;
      (service as any).deviceId = 'test-device-id'; // Ensure deviceId is set
      storageSpy.get.withArgs(REFRESH_TOKEN_KEY).and.returnValue(Promise.resolve(mockOldRefreshToken));
    });

    it('should return null if storage is not initialized', fakeAsync(() => {
      (service as any).storageInitialized = false;
      let resultToken: string | null = 'initial';
      service.refreshAccessToken().then(token => resultToken = token);
      tick();
      expect(resultToken).toBeNull();
      expect(storageSpy.get).not.toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
    }));

    it('should return null if no refresh token is in storage', fakeAsync(() => {
      storageSpy.get.withArgs(REFRESH_TOKEN_KEY).and.returnValue(Promise.resolve(null));
      let resultToken: string | null = 'initial';
      service.refreshAccessToken().then(token => resultToken = token);
      tick();
      expect(resultToken).toBeNull();
    }));

    it('should attempt to load deviceId if not available, then refresh', fakeAsync(() => {
      (service as any).deviceId = null;
      spyOn((service as any), 'loadDeviceId').and.callFake(() => {
        (service as any).deviceId = 'loaded-device-id-for-refresh';
        return Promise.resolve();
      });

      service.refreshAccessToken().then(token => {}); 
      const req = httpMock.expectOne(refreshUrl);
      expect(req.request.body.deviceId).toBe('loaded-device-id-for-refresh');
      req.flush(mockNewAuthResponse);
      tick(); // loadDeviceId, http, storage.set
      expect((service as any).loadDeviceId).toHaveBeenCalled();
    }));

    it('should return null if deviceId cannot be loaded during refresh', fakeAsync(() => {
      (service as any).deviceId = null;
      spyOn((service as any), 'loadDeviceId').and.callFake(() => {
        (service as any).deviceId = null; // Simulate failure
        return Promise.resolve();
      });
      let resultToken: string | null = 'initial';
      service.refreshAccessToken().then(token => resultToken = token);
      tick(); // loadDeviceId
      expect(resultToken).toBeNull();
      httpMock.expectNone(refreshUrl);
    }));

    it('should refresh token successfully, update storage, and subjects', fakeAsync(() => {
      const verifiedUser: User = { id: 1, username: 'test', email: 'test@test.com' };
      spyOn((service as any), 'verifyAndSetUser').and.returnValue(Promise.resolve(verifiedUser));
      (service as any).currentUserSubject.next(null); // Simulate no current user initially

      let resultToken: string | null = null;
      service.refreshAccessToken().then(token => resultToken = token);

      const req = httpMock.expectOne(refreshUrl);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refreshToken: mockOldRefreshToken, deviceId: 'test-device-id' });
      req.flush(mockNewAuthResponse);
      tick(); // for http call, storage.set, and verifyAndSetUser

      if (resultToken === null) {
        fail('resultToken was null after successful token refresh. Expected a string token.');
        return; // Ensure TS knows resultToken is string below
      }

      expect(resultToken).toEqual(mockNewAuthResponse.token!); // Changed toBe to toEqual
      expect(service.getAccessToken()).toBe(mockNewAuthResponse.token!); // Add non-null assertion
      expect(storageSpy.set).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, mockNewAuthResponse.token);
      expect(storageSpy.set).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, mockNewAuthResponse.refreshToken);
      expect((service as any).verifyAndSetUser).toHaveBeenCalledWith(mockNewAuthResponse.token);
      expect(service.getCurrentUser()).toEqual(verifiedUser as any); // Cast to any
    }));

    it('should refresh token successfully and only update access token if refresh token is not rotated', fakeAsync(() => {
      const noRotateResponse = { ...mockNewAuthResponse, refreshToken: undefined }; // Simulate API not returning new refresh token
      spyOn((service as any), 'verifyAndSetUser').and.returnValue(Promise.resolve(null));

      service.refreshAccessToken().then(token => {});
      const req = httpMock.expectOne(refreshUrl);
      req.flush(noRotateResponse);
      tick();

      expect(storageSpy.set).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, noRotateResponse.token);
      expect(storageSpy.set).not.toHaveBeenCalledWith(REFRESH_TOKEN_KEY, jasmine.any(String));
    })); 

    it('should logout and return null if API refresh fails (success: false)', fakeAsync(() => {
      const failResponse = { success: false, message: 'Invalid refresh token' };
      spyOn((service as any), 'logoutAction').and.callThrough();
      let resultToken: string | null = 'initial';

      service.refreshAccessToken().then(token => resultToken = token);
      const req = httpMock.expectOne(refreshUrl);
      req.flush(failResponse);
      tick(); // http, logoutAction

      expect(resultToken).toBeNull();
      expect((service as any).logoutAction).toHaveBeenCalledWith(true);
      expect(service.getAccessToken()).toBeNull();
    }));

    it('should logout and return null if API call for refresh throws HTTP error', fakeAsync(() => {
      spyOn((service as any), 'logoutAction').and.callThrough();
      let resultToken: string | null = 'initial';

      service.refreshAccessToken().then(token => resultToken = token);
      const req = httpMock.expectOne(refreshUrl);
      req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
      tick(); // http, logoutAction

      expect(resultToken).toBeNull();
      expect((service as any).logoutAction).toHaveBeenCalledWith(true);
      expect(service.getAccessToken()).toBeNull();
    }));

    it('should not call verifyAndSetUser if current user already exists during refresh', fakeAsync(() => {
      const existingUser: User = { id: 5, username: 'existing', email: 'exist@test.com' };
      (service as any).currentUserSubject.next(existingUser);
      spyOn((service as any), 'verifyAndSetUser').and.callThrough();

      service.refreshAccessToken().then(token => {});
      const req = httpMock.expectOne(refreshUrl);
      req.flush(mockNewAuthResponse);
      tick();

      expect((service as any).verifyAndSetUser).not.toHaveBeenCalled();
      expect(service.getCurrentUser()).toEqual(existingUser); // Should remain the same
    }));

  });

  describe('logout and logoutAction', () => {
    const logoutUrl = `${environment.apiUrl}/auth/logout`;
    const mockRefreshToken = 'some-refresh-token';

    beforeEach(() => {
      // Simulate an authenticated state
      (service as any).storageInitialized = true;
      (service as any).accessTokenSubject.next('some-access-token');
      (service as any).currentUserSubject.next({ id: 1, username: 'testuser', email: 'test@test.com' });
      storageSpy.get.withArgs(REFRESH_TOKEN_KEY).and.returnValue(Promise.resolve(mockRefreshToken));
    });

    it('logoutAction should clear local storage and subjects, then navigate if specified', fakeAsync(() => {
      (service as any).logoutAction(true); // navigate = true
      tick(); // for storage.get and http.post

      const req = httpMock.expectOne(logoutUrl);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refreshToken: mockRefreshToken });
      req.flush({ success: true }); // Simulate successful backend logout
      tick(); // for async operations after http call

      expect(storageSpy.remove).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
      expect(storageSpy.remove).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
      expect(storageSpy.remove).toHaveBeenCalledWith(USER_KEY);
      expect(service.getAccessToken()).toBeNull();
      expect(service.getCurrentUser()).toBeNull();
      service.isAuthenticated$.subscribe(isAuth => expect(isAuth).toBeFalse());
      tick();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
    }));

    it('logoutAction should clear local storage and subjects, but not navigate if specified false', fakeAsync(() => {
      (service as any).logoutAction(false); // navigate = false
      tick();
      const req = httpMock.expectOne(logoutUrl);
      req.flush({ success: true });
      tick();

      expect(storageSpy.remove).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
      expect(service.getAccessToken()).toBeNull();
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    }));

    it('logoutAction should proceed with local cleanup even if backend logout call fails', fakeAsync(() => {
      (service as any).logoutAction(true);
      tick();
      const req = httpMock.expectOne(logoutUrl);
      req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
      tick();

      expect(storageSpy.remove).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
      expect(service.getAccessToken()).toBeNull();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']); // Still navigates
    }));

    it('logoutAction should not make backend call if no refresh token is found', fakeAsync(() => {
      storageSpy.get.withArgs(REFRESH_TOKEN_KEY).and.returnValue(Promise.resolve(null));
      (service as any).logoutAction(true);
      tick();

      httpMock.expectNone(logoutUrl);
      expect(storageSpy.remove).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
      expect(service.getAccessToken()).toBeNull();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
    }));

    it('logoutAction should still clear local data if storage is not initialized (with warnings)', fakeAsync(() => {
      (service as any).storageInitialized = false;
      (service as any).logoutAction(true);
      tick();

      httpMock.expectNone(logoutUrl); // No backend call as storage isn't ready for refresh token
      expect(storageSpy.remove).not.toHaveBeenCalled(); // No storage removal if not initialized
      expect(service.getAccessToken()).toBeNull(); // Subjects are still cleared
      expect(service.getCurrentUser()).toBeNull();
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/login']);
      expect(console.warn).toHaveBeenCalledWith('AuthService: Storage not initialized, cannot properly logout.');
    }));

    it('logout method should call logoutAction with navigate true', fakeAsync(() => {
      spyOn((service as any), 'logoutAction').and.callThrough();
      service.logout();
      tick();
      expect((service as any).logoutAction).toHaveBeenCalledWith(true);
    }));

  });

  describe('checkAuthStatus', () => {
    beforeEach(() => {
      // Ensure storage is initialized for these tests by default
      (service as any).storageInitialized = true;
      // Ensure deviceId is available
      (service as any).deviceId = 'test-device-id';
    });

    it('should return true if access token exists and is verified successfully', fakeAsync(() => {
      const mockToken = 'valid-token';
      const mockUser: User = { id: 1, username: 'authcheck', email: 'check@test.com' };
      spyOn(service, 'getAccessToken').and.returnValue(mockToken);
      spyOn((service as any), 'verifyAndSetUser').and.returnValue(Promise.resolve(mockUser));

      let status = false;
      service.checkAuthStatus().then(res => status = res);
      tick(); // for verifyAndSetUser

      expect(service.getAccessToken).toHaveBeenCalled();
      expect((service as any).verifyAndSetUser).toHaveBeenCalledWith(mockToken);
      expect(status).toBeTrue();
    }));

    it('should attempt to refresh token and return true if access token verification fails but refresh succeeds', fakeAsync(() => {
      const mockToken = 'invalid-token';
      spyOn(service, 'getAccessToken').and.returnValue(mockToken);
      spyOn((service as any), 'verifyAndSetUser').and.returnValue(Promise.reject('Verification failed'));
      spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve('new-refreshed-token'));

      let status = false;
      service.checkAuthStatus().then(res => status = res);
      tick(); // for verifyAndSetUser and refreshAccessToken

      expect((service as any).verifyAndSetUser).toHaveBeenCalledWith(mockToken);
      expect(service.refreshAccessToken).toHaveBeenCalled();
      expect(status).toBeTrue();
    }));

    it('should return false if access token verification fails and refresh also fails', fakeAsync(() => {
      const mockToken = 'invalid-token';
      spyOn(service, 'getAccessToken').and.returnValue(mockToken);
      spyOn((service as any), 'verifyAndSetUser').and.returnValue(Promise.reject('Verification failed'));
      spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve(null)); // Refresh fails

      let status = false;
      service.checkAuthStatus().then(res => status = res);
      tick(); // for verifyAndSetUser and refreshAccessToken

      expect(status).toBeFalse();
    }));

    it('should attempt to refresh token and return true if no access token exists but refresh succeeds', fakeAsync(() => {
      spyOn(service, 'getAccessToken').and.returnValue(null);
      spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve('new-refreshed-token-no-initial'));
      // verifyAndSetUser would be called internally by refreshAccessToken if it sets a user
      // For this test, we only care about the boolean result of checkAuthStatus based on refresh success

      let status = false;
      service.checkAuthStatus().then(res => status = res);
      tick(); // for refreshAccessToken

      expect(service.refreshAccessToken).toHaveBeenCalled();
      expect(status).toBeTrue();
    }));

    it('should return false if no access token exists and refresh also fails', fakeAsync(() => {
      spyOn(service, 'getAccessToken').and.returnValue(null);
      spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve(null)); // Refresh fails

      let status = false;
      service.checkAuthStatus().then(res => status = res);
      tick(); // for refreshAccessToken

      expect(status).toBeFalse();
    }));

    it('should call initService if storage is not initialized, then proceed', fakeAsync(() => {
      (service as any).storageInitialized = false;
      spyOn((service as any), 'initService').and.callFake(() => {
        (service as any).storageInitialized = true; // Simulate init completing
        (service as any).deviceId = 'device-after-init';
        spyOn(service, 'getAccessToken').and.returnValue(null); // after init, no token
        spyOn(service, 'refreshAccessToken').and.returnValue(Promise.resolve(null)); // and refresh fails
        return Promise.resolve();
      });
      
      let status = true;
      service.checkAuthStatus().then(res => status = res);
      tick(); // for initService and subsequent calls

      expect((service as any).initService).toHaveBeenCalled();
      expect(status).toBeFalse(); // Based on the spies set up within initService mock
    }));
  });

  describe('helper methods', () => {
    it('getAccessToken should return the current access token from subject', () => {
      (service as any).accessTokenSubject.next('test-access-token');
      expect(service.getAccessToken()).toBe('test-access-token');
      (service as any).accessTokenSubject.next(null);
      expect(service.getAccessToken()).toBeNull();
    });

    it('getCurrentUser should return the current user from subject', () => {
      const mockUser: User = { id: 10, username: 'helperuser', email: 'helper@test.com' };
      (service as any).currentUserSubject.next(mockUser);
      expect(service.getCurrentUser()).toEqual(mockUser);
      (service as any).currentUserSubject.next(null);
      expect(service.getCurrentUser()).toBeNull();
    });
  });

  // handleError is implicitly tested by other tests that check for error propagation.
  // Explicit tests for handleError could be added if more specific error formatting was critical.

});
