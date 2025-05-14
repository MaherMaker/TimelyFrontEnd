import { Component, OnInit, NgZone } from '@angular/core';
import { Router, RouterModule, NavigationStart, NavigationEnd, NavigationError, NavigationCancel } from '@angular/router'; // Import Router events
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Storage } from '@ionic/storage-angular';
import { IonApp, IonRouterOutlet, AlertController, Platform } from '@ionic/angular/standalone';
import { AuthService } from './services/auth.service';
import { DeviceService } from './services/device.service';
import { AlarmService } from './services/alarm.service'; // Import AlarmService
import { PushNotifications, Token, PushNotificationSchema, ActionPerformed } from '@capacitor/push-notifications';
import { LocalNotifications, ScheduleOptions } from '@capacitor/local-notifications'; // Import LocalNotifications
import { firstValueFrom } from 'rxjs'; // Ensure firstValueFrom is imported
import { take } from 'rxjs/operators'; // Import take operator

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: true,
  imports: [IonApp, IonRouterOutlet, RouterModule, HttpClientModule, CommonModule]
})
export class AppComponent implements OnInit {
  private authInitializationPromise: Promise<void>; // Keep as Promise<void> for now

  constructor(
    private storage: Storage,
    private authService: AuthService,
    private deviceService: DeviceService,
    private alarmService: AlarmService, // Inject AlarmService
    private platform: Platform,
    private ngZone: NgZone,
    private alertController: AlertController,
    private router: Router // Inject Router
  ) {
    // Initialize the promise here, but it will be reassigned in ngOnInit
    this.authInitializationPromise = Promise.resolve();

    // Log all router events
    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        console.log('Router: NavigationStart ->', event.url, 'id:', event.id, 'navTrigger:', event.navigationTrigger);
      } else if (event instanceof NavigationEnd) {
        console.log('Router: NavigationEnd ->', event.urlAfterRedirects, 'id:', event.id, 'url:', event.url);
      } else if (event instanceof NavigationError) {
        console.error('Router: NavigationError ->', event.url, 'id:', event.id, 'error:', event.error);
      } else if (event instanceof NavigationCancel) {
        console.log('Router: NavigationCancel ->', event.url, 'id:', event.id, 'reason:', event.reason);
      }
    });
  }

  async ngOnInit() {
    // Initialize the storage
    await this.storage.create();
    console.log('AppComponent: Storage created.');

    // Check authentication status and set up the promise
    // We want authInitializationPromise to resolve after checkAuthStatus completes
    // and its effects (like updating isAuthenticated$) have settled.
    this.authInitializationPromise = new Promise<void>(async (resolve) => {
      try {
        const isAuthenticated = await this.authService.checkAuthStatus();
        console.log('AppComponent: Auth status checked via checkAuthStatus. IsAuthenticated:', isAuthenticated);
      } catch (error) {
        console.error('AppComponent: Error checking auth status during init', error);
      } finally {
        console.log('AppComponent: Auth initialization sequence finished.');
        resolve(); // Resolve the main promise for app component
      }
    });

    // Initialize Push Notifications
    if (this.platform.is('capacitor')) {
      this.initializePushNotifications();
    } else {
      console.log('AppComponent: Push notifications are only available on a device.');
    }
  }

  async initializePushNotifications() {
    console.log('AppComponent: Initializing push notifications');

    // Request permission to use push notifications
    PushNotifications.requestPermissions().then(result => {
      this.ngZone.run(() => {
        if (result.receive === 'granted') {
          // Permissions granted
          console.log('AppComponent: Push notification permission granted.');
          PushNotifications.register();
        } else {
          console.warn('AppComponent: Push notification permission not granted.');
        }
      });
    });

    // On success, we should be able to receive notifications
    PushNotifications.addListener('registration', (token: Token) => {
      this.ngZone.run(async () => {
        console.log('AppComponent: Push registration success, token: ' + token.value);
        this.deviceService.registerDeviceToken(token.value);
      });
    });

    // Some issue with registration, perhaps a configuration error
    PushNotifications.addListener('registrationError', (error: any) => {
      this.ngZone.run(() => {
        console.error('AppComponent: Error on registration: ' + JSON.stringify(error));
      });
    });

    // Show us the notification payload if the app is open on our device
    PushNotifications.addListener('pushNotificationReceived', (notification: PushNotificationSchema) => {
      this.ngZone.run(async () => {
        console.log('AppComponent: Push received: ' + JSON.stringify(notification));
        const data = notification.data || {};
        
        // Ensure data types are handled correctly for FCM messages
        // FCM on Android may convert numbers to strings
        const normalizedData = this.normalizeNotificationData(data);

        if (normalizedData.type === 'ALARM_SYNC_REQUEST') {
          console.log('AppComponent: ALARM_SYNC_REQUEST received, calling alarmService.syncAlarms()');
          this.alarmService.syncAlarms().subscribe({
            next: async () => { // Make this async
              console.log('AppComponent: Sync triggered by push notification completed.');
              // Schedule a silent local notification to inform the user
              try {
                // Request permissions for local notifications if not already granted
                const permissionStatus = await LocalNotifications.checkPermissions();
                if (permissionStatus.display !== 'granted') {
                  const requestStatus = await LocalNotifications.requestPermissions();
                  if (requestStatus.display !== 'granted') {
                    console.warn('AppComponent: Local notification permission not granted. Cannot show sync update notification.');
                    return; // Exit if permission is not granted
                  }
                }

                const notifId = Math.floor(Math.random() * 2147483647) + 1; // Ensure positive 32-bit int
                console.log(`AppComponent: Scheduling local notification for sync with ID: ${notifId}`);
                await LocalNotifications.schedule({
                  notifications: [
                    {
                      title: 'Timely Sync', // Changed title for clarity
                      body: 'Alarms have been updated in the background.',
                      id: notifId, // Use the generated integer ID
                      schedule: { at: new Date(Date.now() + 1000) }, // Schedule 1 second from now
                      sound: undefined, // No sound for a silent notification
                      smallIcon: 'res://mipmap/ic_launcher', // Ensure this icon exists
                    }
                  ]
                });
                console.log('AppComponent: Silent local notification scheduled for sync update.');
              } catch (e) {
                console.error('AppComponent: Error scheduling local notification for sync', e);
              }
            },
            error: (err) => console.error('AppComponent: Error during sync triggered by push:', err)
          });
          // Do not proceed to show an alert for ALARM_SYNC_REQUEST
          return; 
        }
        
        // Handle other types of notifications that should display an alert
        if (notification.title && notification.body) {
          const alert = await this.alertController.create({
            header: notification.title,
            message: notification.body,
            buttons: [
              {
                text: 'Dismiss',
                role: 'cancel',
                handler: () => {
                  console.log('AppComponent: Foreground notification dismissed.');
                }
              }
            ]
          });
          await alert.present();
        } else {
          console.log('AppComponent: Received a push notification without a title/body, and not a known data type. Ignoring for alert.', notification);
        }
      });
    });

    // Method called when tapping on a notification
    PushNotifications.addListener('pushNotificationActionPerformed', (notification: ActionPerformed) => {
      this.ngZone.run(async () => {
        console.log('AppComponent: Waiting for auth initialization before processing push action.');
        await this.authInitializationPromise; // Wait for auth to be initialized
        console.log('AppComponent: Auth initialized, proceeding with push action.');

        console.log('AppComponent: Push action performed for: ' + (notification.notification.title || 'Data Notification'));
        const rawData = notification.notification.data || {};
        
        // Normalize data types to prevent ClassCastExceptions
        const data = this.normalizeNotificationData(rawData);
        
        // Ensure we have the latest auth state by waiting for the observable to emit once
        const isAuthenticated = await firstValueFrom(this.authService.isAuthenticated$.pipe(take(1)));
        console.log('AppComponent: isAuthenticated in pushNotificationActionPerformed:', isAuthenticated);

        if (!isAuthenticated) {
          console.log('AppComponent: User not authenticated, redirecting to login.');
          // Optionally, store the intended route from `data` to redirect after login
          let intendedRoute = '/alarms/list'; // Default route
          if (data && data.route) {
            intendedRoute = data.route;
          } else if (data && data.type === 'ALARM_SYNC_REQUEST') {
            intendedRoute = '/alarms/list'; // Or specific page for sync
          }
          this.router.navigate(['/auth/login'], { queryParams: { returnUrl: intendedRoute } }).then(navResult => {
            console.log('AppComponent: Navigation to /auth/login (due to no auth) completed:', navResult);
          }).catch(navError => {
            console.error('AppComponent: Navigation to /auth/login (due to no auth) failed:', navError);
          });
          return;
        }

        // User is authenticated, proceed with normal logic
        if (data && data.type === 'ALARM_SYNC_REQUEST') {
          console.log('AppComponent: Tapped ALARM_SYNC_REQUEST notification. Triggering sync.');
          try {
            console.log('AppComponent: isAuthenticated BEFORE syncAlarms:', await firstValueFrom(this.authService.isAuthenticated$));
            await firstValueFrom(this.alarmService.syncAlarms()); // Use firstValueFrom
            console.log('AppComponent: isAuthenticated AFTER syncAlarms (success):', await firstValueFrom(this.authService.isAuthenticated$));
            console.log('AppComponent: Alarm sync triggered by tapped notification completed.');
          } catch (error) {
            console.error('AppComponent: Error triggering alarm sync from tapped notification', error);
            try {
              console.log('AppComponent: isAuthenticated AFTER syncAlarms (error):', await firstValueFrom(this.authService.isAuthenticated$));
            } catch (e) {
              console.error('AppComponent: Error checking auth state after sync error', e);
            }
          }
          // After sync, navigate to alarms page or a relevant page
          console.log('AppComponent: Navigating to default alarms page after sync from tap.');
          this.router.navigate(['/alarms/list']).then(navResult => {
            console.log('AppComponent: Navigation to /alarms/list completed:', navResult);
          }).catch(navError => {
            console.error('AppComponent: Navigation to /alarms/list failed:', navError);
          });
        } else if (data && data.route) {
          console.log('AppComponent: Navigating to route from notification data:', data.route);
          this.router.navigate([data.route]).then(navResult => {
            console.log('AppComponent: Navigation to', data.route, 'completed:', navResult);
          }).catch(navError => {
            console.error('AppComponent: Navigation to', data.route, 'failed:', navError);
          });
        } else {
          // Default navigation if no specific route or known data type
          console.log('AppComponent: Navigating to default alarms page from tap.');
          this.router.navigate(['/alarms/list']).then(navResult => {
            console.log('AppComponent: Navigation to /alarms/list (default) completed:', navResult);
          }).catch(navError => {
            console.error('AppComponent: Navigation to /alarms/list (default) failed:', navError);
          });
        }
      });
    });

    // Listen for token refresh events
    console.log('AppComponent: Existing \'registration\' listener will handle token refreshes.');
  }

  /**
   * Normalizes FCM notification data types to handle potential type conversion issues
   * FCM on Android may convert numbers to strings which causes ClassCastExceptions
   */
  private normalizeNotificationData(data: any): any {
    if (!data) return {};
    
    const normalized = { ...data };
    
    // Explicitly handle conversion of known numeric fields if needed
    if (typeof normalized.alarmId === 'string' && !isNaN(normalized.alarmId)) {
      normalized.alarmId = parseInt(normalized.alarmId, 10);
    }
    
    if (typeof normalized.userId === 'string' && !isNaN(normalized.userId)) {
      normalized.userId = parseInt(normalized.userId, 10);
    }
    
    // Add other numeric field conversions as needed
    
    return normalized;
  }
}
