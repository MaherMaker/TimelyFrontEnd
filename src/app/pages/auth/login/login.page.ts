import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, 
  IonItem, IonLabel, IonInput, IonButton, 
  IonText, LoadingController, ToastController
} from '@ionic/angular/standalone';
import { take, first } from 'rxjs/operators'; // Added 'first'

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
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
export class LoginPage implements OnInit {
  loginForm: FormGroup;
  isSubmitting = false;
  private returnUrl: string = '/alarms/list';

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {
    this.loginForm = this.formBuilder.group({
      usernameOrEmail: ['', [Validators.required]], // Removed Validators.email
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    // Get return URL from route parameters or default to '/alarms/list'
    this.route.queryParams.subscribe(params => {
      this.returnUrl = params['returnUrl'] || '/alarms/list';
      console.log('Login page: Return URL set to', this.returnUrl);
    });
  }

  ngOnInit() {}

  async login() {
    if (this.loginForm.invalid) {
      return;
    }

    this.isSubmitting = true;
    const loading = await this.loadingController.create({
      message: 'Logging in...'
    });
    await loading.present();

    const credentials = { 
      usernameOrEmail: this.loginForm.value.usernameOrEmail, 
      password: this.loginForm.value.password 
    };

    this.authService.login(credentials).subscribe({
      next: async (response) => {        await loading.dismiss();
        this.isSubmitting = false;        
        if (response.success) {
          console.log('Login successful, navigating to:', this.returnUrl);
          this.router.navigateByUrl(this.returnUrl, { replaceUrl: true }).then(navSuccess => {
            if (navSuccess) {
              console.log(`Navigation to ${this.returnUrl} successful.`);
            } else {
              console.error(`Navigation to ${this.returnUrl} failed.`);
            }
          }).catch(navError => {
            console.error(`Navigation error to ${this.returnUrl}:`, navError);
          });
        } else {
          const errorMessage = response.message || 'Login failed. Please check your credentials.';
          console.error('Login page error - success false:', errorMessage);
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
        let errorMessage = 'Login failed';
        if (error.error && typeof error.error.message === 'string') {
          errorMessage = error.error.message;
        } else if (typeof error.message === 'string') {
          errorMessage = error.message;
        }
        console.error('Login page error:', errorMessage);

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

  goToRegister() {
    this.router.navigateByUrl('/auth/register');
  }
}
