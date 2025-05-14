import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AlarmService } from '../../../services/alarm.service';
import { AuthService } from '../../../services/auth.service';
import { AlarmManagerService, AlarmConfig } from '../../../services/alarm-manager.service'; // Updated import
import { Alarm } from '../../../models/alarm.model';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, 
  IonList, IonItem, IonItemSliding, IonItemOptions, 
  IonItemOption, IonLabel, IonToggle, IonIcon,
  IonButton, IonButtons, IonFab, IonFabButton, 
  LoadingController, AlertController, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  syncOutline, logOutOutline, alarmOutline,
  trashOutline, add
} from 'ionicons/icons';
import { Observable, Subscription } from 'rxjs';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-list',
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonList, IonItem, IonItemSliding, IonItemOptions,
    IonItemOption, IonLabel, IonToggle, IonIcon,
    IonButton, IonButtons, IonFab, IonFabButton
  ]
})
export class ListPage implements OnInit, OnDestroy {
  alarms$: Observable<Alarm[]>;
  isLoading = false;
  deviceId: string;
  private alarmSubscription: Subscription | undefined;

  constructor(
    private alarmService: AlarmService,
    private authService: AuthService,
    private alarmManagerService: AlarmManagerService, // Injected AlarmManagerService
    private router: Router,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private toastController: ToastController
  ) {
    addIcons({
      'sync-outline': syncOutline,
      'log-out-outline': logOutOutline,
      'alarm-outline': alarmOutline,
      'trash-outline': trashOutline,
      'add': add
    });

    this.deviceId = localStorage.getItem('device_id') || this.generateDeviceId();
    localStorage.setItem('device_id', this.deviceId);

    this.alarms$ = this.alarmService.alarms$;
  }

  async ngOnInit() { // Changed to async
    console.log('ListPage: ngOnInit called');
    try {
      console.log('ListPage: Requesting permissions...');
      await this.alarmManagerService.checkAndRequestPermissions();
      console.log('ListPage: Permissions check/request complete.');
    } catch (e) {
      console.error('ListPage: Error during permission check/request on init:', e);
    }
    this.loadAlarms();
  }

  ngOnDestroy() {
    if (this.alarmSubscription) {
      this.alarmSubscription.unsubscribe();
    }
  }

  generateDeviceId(): string {
    return 'device_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async loadAlarms() {
    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: 'Loading alarms...'
    });
    await loading.present();

    this.alarmSubscription = this.alarmService.loadAlarms().subscribe({
      next: (alarms) => {
        loading.dismiss();
        this.isLoading = false;
        console.log('Alarms loaded in component:', alarms);
      },
      error: async (error: Error) => {
        loading.dismiss();
        this.isLoading = false;
        this.showToast(error.message || 'Failed to load alarms', 'danger');
      }
    });
  }

  async syncAlarms() {
    const loading = await this.loadingController.create({
      message: 'Syncing alarms...'
    });
    await loading.present();

    this.alarms$.pipe(take(1)).subscribe(currentAlarms => {
      this.alarmService.syncAlarms().subscribe({
        next: async (_syncedAlarms: Alarm[]) => { // Mark syncedAlarms as unused
          loading.dismiss();
          this.showToast('Alarms synced successfully', 'success');
        },
        error: async (error: Error) => {
          loading.dismiss();
          this.showToast(error.message || 'Failed to sync alarms', 'danger');
        }
      });
    });
  }

  async toggleAlarm(alarm: Alarm) {
    if (alarm.id === undefined) {
      this.showToast('Cannot toggle alarm: Alarm ID is missing.', 'danger');
      console.error('Attempted to toggle alarm without an ID.');
      return;
    }
    const alarmIdToToggle = alarm.id; // Ensures alarmIdToToggle is number

    this.alarmService.toggleAlarmActive(alarmIdToToggle).subscribe({
      next: (updatedAlarm: Alarm) => {
        console.log('Alarm toggle successful via HTTP', updatedAlarm);
      },
      error: async (error: Error) => {
        this.showToast(error.message || 'Failed to toggle alarm', 'danger');
      }
    });
  }

  editAlarm(alarm: Alarm, event?: Event) {
    if (event) event.stopPropagation();
    if (alarm.id) {
      this.router.navigateByUrl(`/alarms/detail/${alarm.id}`);
    }
  }

  createAlarm() {
    this.router.navigateByUrl('/alarms/detail');
  }

  async deleteAlarm(alarm: Alarm, event: Event) {
    event.stopPropagation();
    if (!alarm.id) {
      console.warn('Attempted to delete alarm without an ID.'); // Optional: added warning
      return;
    }
    const alarmIdToDelete = alarm.id; // Store the ID after the check, ensuring it's a number

    const alert = await this.alertController.create({
      header: 'Delete Alarm',
      message: `Are you sure you want to delete "${alarm.title}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.alarmService.deleteAlarm(alarmIdToDelete).subscribe({ // Use the new variable
              next: async () => {
                this.showToast('Alarm deleted successfully', 'success');
              },
              error: async (error: Error) => {
                this.showToast(error.message || 'Failed to delete alarm', 'danger');
              }
            });
          }
        }
      ]
    });
    await alert.present();
  }
  async logout() {
    try {
      await this.authService.logout();
      this.router.navigate(['/auth/login'], { replaceUrl: true });
      this.showToast('Logged out successfully', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to logout';
      this.showToast(errorMessage, 'danger');
      console.error('Logout failed:', error);
    }
  }

  async testNativeAlarm() {
    console.log('ListPage: testNativeAlarm button clicked');
    try {
      const now = Date.now();
      const alarmConfig: AlarmConfig = {
        alarmId: `test-${now.toString()}`,
        at: now + 60000, // 60 seconds from now
        name: 'TestAlarmInternalName', // Optional: internal name for the alarm
        exact: true, // For a precise, non-repeating alarm
        uiOptions: {
          titleText: 'Test Native Alarm',
          alarmNameText: 'This is a test notification! (UI)'
        },
        extra: {
          customData: 'This is a test notification from the native alarm plugin! (extra data)',
          originalId: now // Storing original timestamp as an example
        }
      };

      console.log('ListPage: Calling setNativeAlarm (plugin .set) with AlarmConfig:', JSON.stringify(alarmConfig));
      // The service method is still called setNativeAlarm, but it calls plugin.set internally
      const result = await this.alarmManagerService.setNativeAlarm(alarmConfig);
      console.log('ListPage: setNativeAlarm (plugin .set) result in component:', result);
      this.showToast(`Test alarm set (ID: ${result.alarmId}). Check Logcat & device alarms.`, 'success');
    } catch (error) {
      console.error('ListPage: Error testing native alarm with .set:', error);
      if (error instanceof Error) {
        console.error('ListPage: Error name:', error.name, 'Error message:', error.message);
      }
      this.showToast('Error setting test alarm. Check console/Logcat.', 'danger');
    }
  }

  formatTime(time: string | undefined): string {
    if (!time) return '--:--';
    try {
      const [hours, minutes] = time.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const hour12 = hours % 12 || 12;
      return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
    } catch (error) {
      return time;
    }
  }

  formatDays(days: number[] | undefined | null): string {
    if (!days || days.length === 0) return 'No repeat';
    if (days.length === 7) return 'Every day';

    const numericDays = [...days].sort((a, b) => a - b);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return numericDays.map(day => dayNames[day]).join(', ');
  }

  async showToast(message: string, color: 'success' | 'warning' | 'danger') {
    const toast = await this.toastController.create({
      message: message,
      duration: color === 'success' ? 2000 : 3000,
      position: 'bottom',
      color: color
    });
    toast.present();
  }
}
