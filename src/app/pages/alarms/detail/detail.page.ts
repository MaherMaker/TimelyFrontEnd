import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AlarmService } from '../../../services/alarm.service';
import { Alarm } from '../../../models/alarm.model';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonBackButton,
  IonItem, IonLabel, IonInput, IonButton, IonButtons,
  IonChip, IonListHeader, IonSelect, IonSelectOption,
  IonRange, IonToggle, IonIcon, LoadingController, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { volumeLowOutline, volumeHighOutline } from 'ionicons/icons';

@Component({
  selector: 'app-detail',
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  standalone: true,
  imports: [
    CommonModule, 
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonBackButton,
    IonItem, IonLabel, IonInput, IonButton, IonButtons,
    IonChip, IonListHeader, IonSelect, IonSelectOption,
    IonRange, IonToggle, IonIcon
  ]
})
export class DetailPage implements OnInit {
  alarmForm: FormGroup;
  isSubmitting = false;
  isEditMode = false;
  alarmId?: number;
  deviceId: string;
  weekDays = [
    { id: 0, name: 'Sunday', selected: false },
    { id: 1, name: 'Monday', selected: false },
    { id: 2, name: 'Tuesday', selected: false },
    { id: 3, name: 'Wednesday', selected: false },
    { id: 4, name: 'Thursday', selected: false },
    { id: 5, name: 'Friday', selected: false },
    { id: 6, name: 'Saturday', selected: false }
  ];

  constructor(
    private formBuilder: FormBuilder,
    private alarmService: AlarmService,
    private router: Router,
    private route: ActivatedRoute,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {
    // Add icons for use in the template
    addIcons({
      'volume-low-outline': volumeLowOutline,
      'volume-high-outline': volumeHighOutline
    });
    
    this.deviceId = localStorage.getItem('device_id') || 'unknown_device';
    this.alarmForm = this.formBuilder.group({
      title: ['Alarm', [Validators.required]],
      time: ['', [Validators.required]], // Initialize time as empty or fetch default
      isActive: [true],
      sound: ['default'],
      volume: [80, [Validators.min(0), Validators.max(100)]],
      vibration: [true],
      snoozeInterval: [5, [Validators.min(1), Validators.max(30)]],
      snoozeCount: [3, [Validators.min(0), Validators.max(10)]],
      noRepeat: [false]
    });
  }

  ngOnInit() {
    this.route.params.subscribe(params => {
      const id = params['id'];
      if (id) {
        this.alarmId = +id;
        this.isEditMode = true;
        this.loadAlarm(this.alarmId);
      } else {
        // Set default time for new alarms if needed
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        this.alarmForm.patchValue({ time: `${hours}:${minutes}` });
      }
    });
  }

  async loadAlarm(id: number) {
    const loading = await this.loadingController.create({
      message: 'Loading alarm details...'
    });
    await loading.present();

    this.alarmService.getAlarm(id).subscribe({
      next: (response: any) => { // Changed parameter name for clarity
        console.log('Received alarm data from service:', JSON.stringify(response, null, 2)); 

        const actualAlarm = response.alarm; // Access the nested alarm object

        if (!actualAlarm) {
          loading.dismiss();
          this.showToast('Alarm data not found in response', 'danger'); // Clarified message
          this.router.navigateByUrl('/alarms/list');
          return;
        }
        loading.dismiss();
        // Patch form values using actualAlarm
        this.alarmForm.patchValue({
          title: actualAlarm.title == null ? '' : actualAlarm.title,
          time: actualAlarm.time == null ? '' : actualAlarm.time,
          isActive: actualAlarm.isActive == null ? true : actualAlarm.isActive, 
          sound: actualAlarm.sound || 'default', 
          volume: actualAlarm.volume == null ? 80 : actualAlarm.volume, 
          vibration: actualAlarm.vibration == null ? true : actualAlarm.vibration, 
          snoozeInterval: actualAlarm.snoozeInterval == null ? 5 : actualAlarm.snoozeInterval, 
          snoozeCount: actualAlarm.snoozeCount == null ? 3 : actualAlarm.snoozeCount, 
          noRepeat: actualAlarm.noRepeat == null ? false : actualAlarm.noRepeat 
        });
        console.log('Alarm form value after patchValue:', JSON.stringify(this.alarmForm.value, null, 2)); 

        // Update selected days based on the number array from actualAlarm
        const selectedDayIds = actualAlarm.days || []; 
        this.weekDays.forEach(day => {
          day.selected = selectedDayIds.includes(day.id);
        });

      },
      error: async (error: any) => { // Explicitly type error
        loading.dismiss();
        // Use the error message from the service's handleError
        this.showToast(error.message || 'Failed to load alarm details', 'danger');
        this.router.navigateByUrl('/alarms/list');
      }
    });
  }

  async saveAlarm() {
    if (this.alarmForm.invalid) {
      return;
    }

    const selectedDays = this.weekDays
      .filter(day => day.selected)
      .map(day => day.id); // Send days as numbers (0-6)

    // Construct the payload, ensuring required fields are present
    const alarmData = {
      title: this.alarmForm.value.title,
      time: this.alarmForm.value.time,
      days: selectedDays, // Send as number array
      isActive: this.alarmForm.value.isActive,
      sound: this.alarmForm.value.sound,
      volume: this.alarmForm.value.volume,
      vibration: this.alarmForm.value.vibration,
      snoozeInterval: this.alarmForm.value.snoozeInterval,
      snoozeCount: this.alarmForm.value.snoozeCount,
      noRepeat: this.alarmForm.value.noRepeat,
      deviceId: this.deviceId
    };

    const finalPayload: Omit<Alarm, 'id'> | Partial<Alarm> = alarmData;

    const loading = await this.loadingController.create({
      message: this.isEditMode ? 'Updating alarm...' : 'Creating alarm...'
    });
    await loading.present();

    const operation = this.isEditMode && this.alarmId
      ? this.alarmService.updateAlarm(this.alarmId, finalPayload as Partial<Alarm>) // update takes Partial<Alarm>
      : this.alarmService.addAlarm(finalPayload as Omit<Alarm, 'id'>); // Changed createAlarm to addAlarm

    operation.subscribe({
      next: async (savedAlarm: Alarm | undefined) => { // Expecting Alarm or undefined
        loading.dismiss();
        this.isSubmitting = false;
        this.showToast(`Alarm ${this.isEditMode ? 'updated' : 'created'} successfully`, 'success');
        this.router.navigateByUrl('/alarms/list');
      },
      error: async (error: any) => { // Explicitly type error
        loading.dismiss();
        this.isSubmitting = false;
        // Use the error message from the service's handleError
        this.showToast(error.message || `Failed to ${this.isEditMode ? 'update' : 'create'} alarm`, 'danger');
      }
    });
  }

  toggleDay(day: any) {
    day.selected = !day.selected;
  }

  cancel() {
    this.router.navigateByUrl('/alarms/list');
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
