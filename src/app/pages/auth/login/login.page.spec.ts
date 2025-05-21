import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule, ToastController } from '@ionic/angular'; // Import ToastController
import { ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { LoginPage } from './login.page';
import { AuthService } from '../../../services/auth.service';
import { StorageService } from 'src/app/services/storage.service'; // Changed import path
import { AuthResponse } from '../../../models/user.model'; // Import AuthResponse
import { of, throwError } from 'rxjs'; // Import of and throwError for Observables

describe('LoginPage', () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let storageServiceSpy: jasmine.SpyObj<StorageService>;
  let toastControllerSpy: jasmine.SpyObj<ToastController>; // Add

  beforeEach(waitForAsync(() => {
    const authSpy = jasmine.createSpyObj('AuthService', ['login']);
    const storageSpy = jasmine.createSpyObj('StorageService', ['set']);
    
    // Create a spy for ToastController
    const toastCtrlSpy = jasmine.createSpyObj('ToastController', ['create']);
    const toastSpyInstance = jasmine.createSpyObj('Toast', ['present']);
    toastCtrlSpy.create.and.returnValue(Promise.resolve(toastSpyInstance));

    TestBed.configureTestingModule({
      declarations: [ LoginPage ],
      imports: [
        IonicModule.forRoot(),
        ReactiveFormsModule
      ],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: StorageService, useValue: storageSpy }, // Keep for now
        { provide: ToastController, useValue: toastCtrlSpy }, // Add
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    authServiceSpy = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    storageServiceSpy = TestBed.inject(StorageService) as jasmine.SpyObj<StorageService>;
    toastControllerSpy = TestBed.inject(ToastController) as jasmine.SpyObj<ToastController>; // Add
    
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('login form should be invalid when empty', () => {
    expect(component.loginForm.valid).toBeFalsy();
  });

  it('email field validity', () => {
    const email = component.loginForm.controls['email'];
    expect(email.valid).toBeFalsy();

    // Email field is required
    expect(email.hasError('required')).toBeTruthy();

    // Set email to something invalid
    email.setValue('test');
    expect(email.hasError('email')).toBeTruthy();

    // Set email to something valid
    email.setValue('test@example.com');
    expect(email.hasError('required')).toBeFalsy();
    expect(email.hasError('email')).toBeFalsy();
    expect(email.valid).toBeTruthy();
  });

  it('password field validity', () => {
    const password = component.loginForm.controls['password'];
    expect(password.valid).toBeFalsy();

    // Password field is required
    expect(password.hasError('required')).toBeTruthy();

    // Set password to something valid
    password.setValue('123456');
    expect(password.hasError('required')).toBeFalsy();
    expect(password.valid).toBeTruthy();
  });

  // Add more tests for the login logic, service calls, navigation, etc.
  // Example:
  it('should call authService.login on submit if form is valid', async () => {
    component.loginForm.controls['usernameOrEmail'].setValue('test@example.com');
    component.loginForm.controls['password'].setValue('password123');
    expect(component.loginForm.valid).toBeTruthy();

    const mockAuthResponse: AuthResponse = { success: true, token: 'fake-token', refreshToken: 'fake-refresh-token', userId: 1, username: 'test', message: 'Login successful' };
    authServiceSpy.login.and.returnValue(of(mockAuthResponse));

    await component.login(); // Changed from onSubmit to login

    expect(authServiceSpy.login.calls.count()).toBe(1);
    expect(authServiceSpy.login).toHaveBeenCalledWith({ usernameOrEmail: 'test@example.com', password: 'password123' }); // Updated to match new signature
  });

  it('should show error toast if login fails', async () => {
    component.loginForm.controls['usernameOrEmail'].setValue('test@example.com');
    component.loginForm.controls['password'].setValue('password123');
    authServiceSpy.login.and.returnValue(throwError(() => new Error('Login failed')));

    await component.login(); // Changed from onSubmit to login

    expect(authServiceSpy.login.calls.count()).toBe(1);
    expect(toastControllerSpy.create).toHaveBeenCalled();
    const toastInstance = await toastControllerSpy.create.calls.mostRecent().returnValue;
    expect(toastInstance.present).toHaveBeenCalled();
  });
});
