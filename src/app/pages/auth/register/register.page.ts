import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, 
  IonItem, IonLabel, IonInput, IonButton, 
  IonText, LoadingController, ToastController
} from '@ionic/angular/standalone';
import { first } from 'rxjs/operators'; // Import first

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    ReactiveFormsModule, 
    IonHeader, 
    IonToolbar, 
    IonTitle, 
    IonContent, 
    IonItem, 
    IonLabel, 
    IonInput, 
    IonButton,
    IonText
  ]
})
export class RegisterPage implements OnInit {
  registerForm: FormGroup;
  isSubmitting = false;

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {
    this.registerForm = this.formBuilder.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  ngOnInit() {}

  // Custom validator to check if passwords match
  passwordMatchValidator(form: FormGroup) {
    const password = form.get('password')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;

    if (password !== confirmPassword) {
      form.get('confirmPassword')?.setErrors({ passwordMismatch: true });
      return { passwordMismatch: true };
    }
    
    // Clear error if they match and it was previously set
    if (form.get('confirmPassword')?.hasError('passwordMismatch')) {
      form.get('confirmPassword')?.setErrors(null);
    }
    return null;
  }

  async register() {
    if (this.registerForm.invalid) {
      // Mark all fields as touched to display validation errors
      Object.values(this.registerForm.controls).forEach(control => {
        control.markAsTouched();
      });
      return;
    }

    this.isSubmitting = true;
    const loading = await this.loadingController.create({
      message: 'Creating account...'
    });
    await loading.present();

    this.authService.register(this.registerForm.value).subscribe({
      next: async (response) => {
        await loading.dismiss();
        this.isSubmitting = false;
        if (response.success) {
          console.log('Registration successful, navigating to /alarms/list');
          this.router.navigateByUrl('/alarms/list', { replaceUrl: true }).then(navSuccess => {
            if (navSuccess) {
              console.log('Navigation to /alarms/list successful post-registration.');
            } else {
              console.error('Navigation to /alarms/list failed post-registration.');
            }
          }).catch(navError => {
            console.error('Navigation error to /alarms/list post-registration:', navError);
          });
        } else {
          const errorMessage = response.message || 'Registration failed. Please try again.';
          console.error('Registration page error - success false:', errorMessage);
          const toast = await this.toastController.create({
            message: errorMessage,
            duration: 3000,
            position: 'bottom',
            color: 'danger'
          });
          toast.present();
        }
      },
      error: async (error) => {
        await loading.dismiss();
        this.isSubmitting = false;
        let errorMessage = 'Registration failed';
        if (error.error && typeof error.error.message === 'string') {
          errorMessage = error.error.message;
        } else if (typeof error.message === 'string') {
          errorMessage = error.message;
        }
        console.error('Registration page error:', errorMessage);
        const toast = await this.toastController.create({
          message: errorMessage,
          duration: 3000,
          position: 'bottom',
          color: 'danger'
        });
        toast.present();
      }
    });
  }

  goToLogin() {
    this.router.navigateByUrl('/auth/login');
  }
}
