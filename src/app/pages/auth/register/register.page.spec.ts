import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController } from '@ionic/angular';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { RegisterPage } from './register.page';
import { AuthService } from '../../../services/auth.service';
import { AuthResponse, RegisterRequest } from '../../../models/user.model'; // Import AuthResponse and RegisterRequest
import { of, throwError } from 'rxjs'; // Import of and throwError

describe('RegisterPage', () => {
  let component: RegisterPage;
  let fixture: ComponentFixture<RegisterPage>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let routerSpy: jasmine.SpyObj<Router>;
  let toastControllerSpy: jasmine.SpyObj<ToastController>;
  let loadingControllerSpy: jasmine.SpyObj<LoadingController>;

  beforeEach(waitForAsync(() => {
    const authSpy = jasmine.createSpyObj('AuthService', ['register']);
    const routerNavSpy = jasmine.createSpyObj('Router', ['navigateByUrl']);
    const toastSpy = jasmine.createSpyObj('ToastController', ['create']);
    const loadingSpy = jasmine.createSpyObj('LoadingController', ['create']);

    TestBed.configureTestingModule({
      imports: [ReactiveFormsModule, IonicModule.forRoot(), RegisterPage],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: Router, useValue: routerNavSpy },
        { provide: ToastController, useValue: toastSpy },
        { provide: LoadingController, useValue: loadingSpy },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterPage);
    component = fixture.componentInstance;
    authServiceSpy = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    routerSpy = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    toastControllerSpy = TestBed.inject(ToastController) as jasmine.SpyObj<ToastController>;
    loadingControllerSpy = TestBed.inject(LoadingController) as jasmine.SpyObj<LoadingController>;
    
    // Mock the create method of ToastController to return a promise that resolves to a toast spy object
    const toastSpyInstance = jasmine.createSpyObj('Toast', ['present']);
    toastControllerSpy.create.and.returnValue(Promise.resolve(toastSpyInstance));

    // Mock the create method of LoadingController to return a promise that resolves to a loading spy object
    const loadingSpyInstance = jasmine.createSpyObj('Loading', ['present', 'dismiss']);
    loadingControllerSpy.create.and.returnValue(Promise.resolve(loadingSpyInstance));

    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('registration form should be invalid when empty', () => {
    expect(component.registerForm.valid).toBeFalsy();
  });

  it('email field validity', () => {
    const email = component.registerForm.controls['email'];
    expect(email.valid).toBeFalsy();
    expect(email.hasError('required')).toBeTruthy();
    email.setValue('test');
    expect(email.hasError('email')).toBeTruthy();
    email.setValue('test@example.com');
    expect(email.valid).toBeTruthy();
  });

  it('username field validity', () => {
    const username = component.registerForm.controls['username'];
    expect(username.valid).toBeFalsy();
    expect(username.hasError('required')).toBeTruthy();
    username.setValue('usr');
    expect(username.hasError('minlength')).toBeTruthy();
    username.setValue('usertest');
    expect(username.valid).toBeTruthy(); // Corrected this line
  });

  it('password field validity', () => {
    const password = component.registerForm.controls['password'];
    expect(password.valid).toBeFalsy();
    expect(password.hasError('required')).toBeTruthy();
    password.setValue('123');
    expect(password.hasError('minlength')).toBeTruthy();
    password.setValue('123456');
    expect(password.valid).toBeTruthy();
  });

  it('confirmPassword field validity and matching', () => {
    const password = component.registerForm.controls['password'];
    const confirmPassword = component.registerForm.controls['confirmPassword'];
    
    expect(confirmPassword.valid).toBeFalsy();
    expect(confirmPassword.hasError('required')).toBeTruthy();

    password.setValue('123456');
    confirmPassword.setValue('12345');
    expect(confirmPassword.hasError('passwordMismatch')).toBeTruthy();
    
    confirmPassword.setValue('123456');
    expect(confirmPassword.valid).toBeTruthy();
    expect(component.registerForm.hasError('passwordMismatch')).toBeFalsy();
  });

  it('should call authService.register on valid form submission and navigate to alarms list', async () => {
    component.registerForm.controls['username'].setValue('testuser');
    component.registerForm.controls['email'].setValue('test@example.com');
    component.registerForm.controls['password'].setValue('password123');
    component.registerForm.controls['confirmPassword'].setValue('password123');
    expect(component.registerForm.valid).toBeTruthy();

    const loadingElementSpy = jasmine.createSpyObj('HTMLIonLoadingElement', ['present', 'dismiss']);
    loadingControllerSpy.create.and.returnValue(Promise.resolve(loadingElementSpy));
    routerSpy.navigateByUrl.and.returnValue(Promise.resolve(true)); // Mock navigateByUrl to return a Promise

    const mockRegisterPayload: RegisterRequest = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123'
    };
    const mockAuthResponse: AuthResponse = { success: true, token: 'fake-token', refreshToken: 'fake-refresh-token', userId: 1, username: 'testuser', message: 'Registration successful' };
    authServiceSpy.register.and.returnValue(of(mockAuthResponse));
    
    await component.register(); // Changed from onSubmit to register

    expect(loadingControllerSpy.create).toHaveBeenCalled();
    expect(loadingElementSpy.present).toHaveBeenCalled();
    expect(authServiceSpy.register).toHaveBeenCalledWith(jasmine.objectContaining(mockRegisterPayload)); // Updated to match new signature
    expect(routerSpy.navigateByUrl).toHaveBeenCalledWith('/alarms/list'); // Navigation is to /alarms/list now
    expect(loadingElementSpy.dismiss).toHaveBeenCalled();
  });

  it('should show error toast if registration fails', async () => {
    component.registerForm.controls['username'].setValue('testuser');
    component.registerForm.controls['email'].setValue('test@example.com');
    component.registerForm.controls['password'].setValue('password123');
    component.registerForm.controls['confirmPassword'].setValue('password123');

    const loadingElementSpy = jasmine.createSpyObj('HTMLIonLoadingElement', ['present', 'dismiss']);
    loadingControllerSpy.create.and.returnValue(Promise.resolve(loadingElementSpy));
    const toastElementSpy = jasmine.createSpyObj('HTMLIonToastElement', ['present']); // Mock for toast element
    toastControllerSpy.create.and.returnValue(Promise.resolve(toastElementSpy)); // toastController.create returns a Promise
    authServiceSpy.register.and.returnValue(throwError(() => new Error('Registration failed')));

    await component.register(); // Changed from onSubmit to register

    expect(loadingElementSpy.dismiss).toHaveBeenCalled();
    expect(toastControllerSpy.create).toHaveBeenCalledWith(
      jasmine.objectContaining({
        message: 'Registration failed', // Adjusted to match the actual error message being passed
        color: 'danger',
      })
    );
    expect(toastElementSpy.present).toHaveBeenCalled(); // Check if toast.present was called
    expect(routerSpy.navigateByUrl).not.toHaveBeenCalled();
  });

  // Add more tests here for form validation, registration success/failure, navigation, etc.
});
