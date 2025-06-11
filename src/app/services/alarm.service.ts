import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, throwError, from, of } from 'rxjs';
import { catchError, tap, map, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { ToastController } from '@ionic/angular';
import { AlarmManagerService, AlarmConfig } from './alarm-manager.service';
import { io, Socket } from 'socket.io-client';
import { App, AppState } from '@capacitor/app';
import { Alarm as AppAlarm } from '../models/alarm.model';

@Injectable({
  providedIn: 'root'
})
export class AlarmService {
  private apiUrl = `${environment.apiUrl}/alarms`;
  private alarmsSubject = new BehaviorSubject<AppAlarm[]>([]);
  alarms$ = this.alarmsSubject.asObservable();
  private socket: Socket | undefined;
  private socketConnected = new BehaviorSubject<boolean>(false);
  private isConnecting = false;
  private appStateListener: { remove: () => Promise<void> } | null = null;
  private initialAlarmsLoaded = false; // Added this flag

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private toastController: ToastController,
    private alarmManagerService: AlarmManagerService
  ) {
    this.authService.isAuthenticated$.pipe(
      switchMap(isAuth => {
        if (isAuth) {
          this.connectSocket();
          return from(this.alarmManagerService.checkAndRequestPermissions()).pipe(
            switchMap(() => {
              if (!this.initialAlarmsLoaded) {
                console.log('AlarmService: Authenticated and initialAlarmsLoaded is false. Loading alarms from backend.');
                return this.loadAlarms().pipe(
                  tap(() => {
                    this.initialAlarmsLoaded = true;
                    console.log('AlarmService: Initial alarms fetched and initialAlarmsLoaded set to true.');
                  })
                );
              } else {
                console.log('AlarmService: Authenticated and initial alarms already loaded. Using current alarms from subject for processing.');
                return of(this.alarmsSubject.getValue());
              }
            }),
            tap(alarmsForProcessing => {
              console.log('AlarmService: Auth change & permissions checked. Processing alarms for native scheduling:', alarmsForProcessing.length > 0 ? alarmsForProcessing : 'No alarms to process.');
              alarmsForProcessing.forEach(alarm => this.scheduleNativeAlarmIfNeeded(alarm));
            })
          );
        } else {
          this.disconnectSocket();
          this.cancelAllNativeAlarms();
          this.alarmsSubject.next([]);
          this.initialAlarmsLoaded = false; // Reset flag
          console.log('AlarmService: Deauthenticated. Cleaned up alarms and reset initialAlarmsLoaded.');
          return of([]);
        }
      }),
      catchError(error => {
        console.error("AlarmService: Error in isAuthenticated$ subscription:", error);
        this.alarmsSubject.next([]);
        this.initialAlarmsLoaded = false; // Reset flag on error
        return of([]);
      })
    ).subscribe();

    this.initializeAppLifecycleListeners();
  }

  async ngOnDestroy() {
    if (this.appStateListener) {
      await this.appStateListener.remove();
      this.appStateListener = null;
    }
    this.disconnectSocket();
  }

  private async initializeAppLifecycleListeners(): Promise<void> {
    if (this.appStateListener) {
      try {
        await this.appStateListener.remove();
      } catch (e) {
        console.warn("AlarmService: Could not remove previous app state listener", e);
      }
      this.appStateListener = null;
    }
    try {
      this.appStateListener = await App.addListener('appStateChange', (state: AppState) => {
        console.log('AlarmService: App state changed', state);
        if (state.isActive) {
          console.log('AlarmService: App became active. Checking socket connection.');
          setTimeout(() => {
            if (this.authService.getAccessToken() && (!this.socket || !this.socket.connected)) {
              console.log('AlarmService: App active and authenticated, attempting to connect socket.');
              this.connectSocket();
            } else if (!this.authService.getAccessToken()) {
              console.log('AlarmService: App active but not authenticated, socket will not be connected by app state change.');
            }
          }, 1000);
        } else {
          console.log('AlarmService: App is going to background/inactive.');
        }
      });
    } catch (e) {
      console.error("AlarmService: Failed to add App state listener", e);
    }
  }

  private connectSocket(): void {
    if (this.socket && this.socket.connected) {
      console.log('AlarmService: Socket already connected.');
      this.isConnecting = false;
      return;
    }

    if (this.isConnecting) {
      console.log('AlarmService: Socket connection attempt already in progress.');
      return;
    }

    const token = this.authService.getAccessToken();
    const deviceId = this.authService.getDeviceId();

    if (!token || !deviceId) {
      console.warn('AlarmService: Cannot connect socket, token or deviceId missing.');
      this.isConnecting = false;
      return;
    }

    this.isConnecting = true;
    console.log(`AlarmService: Attempting to connect socket with deviceId: ${deviceId}`);

    if (this.socket) {
      this.socket.disconnect();
    }

    let socketUrl = environment.apiUrl;
    try {
      const url = new URL(environment.apiUrl);
      socketUrl = url.origin;
      console.log(`AlarmService: Derived socket URL: ${socketUrl} from apiUrl: ${environment.apiUrl}`);
    } catch (e) {
      console.error(`AlarmService: Invalid environment.apiUrl, cannot derive origin for socket connection. Using as is: ${environment.apiUrl}`, e);
    }

    this.socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      auth: {
        token: `Bearer ${token}`
      },
      query: {
        deviceId: deviceId
      },
    });

    this.socket.on('connect', () => {
      console.log('AlarmService: Socket connected successfully. Socket ID:', this.socket?.id);
      this.socketConnected.next(true);
      this.isConnecting = false;
      this.setupSocketListeners();
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`AlarmService: Socket disconnected. Reason: ${reason}`);
      this.socketConnected.next(false);
      this.isConnecting = false;
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('AlarmService: Socket connection error.', error);
      this.socketConnected.next(false);
      this.isConnecting = false;
    });
  }

  private disconnectSocket(): void {
    if (this.socket) {
      console.log('AlarmService: Disconnecting socket.');
      this.socket.off('connect');
      this.socket.off('disconnect');
      this.socket.off('connect_error');
      this.socket.off('alarm_created');
      this.socket.off('alarm_updated');
      this.socket.off('alarm_deleted');
      this.socket.disconnect();
      this.socket = undefined;
      this.socketConnected.next(false);
      this.isConnecting = false;
    }
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on('alarm_created', async (newAlarmFromServer: AppAlarm) => {
      console.log('AlarmService: Received alarm_created event', newAlarmFromServer);
      const processedAlarm = await this.scheduleNativeAlarmIfNeeded(newAlarmFromServer);
      const currentAlarms = this.alarmsSubject.getValue();
      if (!currentAlarms.find(a => a.id === processedAlarm.id)) {
        this.alarmsSubject.next([...currentAlarms, processedAlarm]);
      }
    });

    this.socket.on('alarm_updated', async (updatedAlarmFromServer: AppAlarm) => {
      console.log('AlarmService: Received alarm_updated event', updatedAlarmFromServer);
      const currentLocalAlarms = this.alarmsSubject.getValue();
      const localAlarmVersion = currentLocalAlarms.find(a => a.id === updatedAlarmFromServer.id);
      const alarmToProcess: AppAlarm = { ...updatedAlarmFromServer, nativeAlarmId: localAlarmVersion?.nativeAlarmId };
      await this.scheduleNativeAlarmIfNeeded(alarmToProcess);
    });

    this.socket.on('alarm_deleted', async (deletedAlarmInfo: { id: number }) => {
      console.log('AlarmService: Received alarm_deleted event', deletedAlarmInfo);
      await this.cancelNativeAlarmByBackendId(deletedAlarmInfo.id);
      const currentAlarms = this.alarmsSubject.getValue();
      this.alarmsSubject.next(currentAlarms.filter(a => a.id !== deletedAlarmInfo.id));
    });
  }

  private getRequestOptions(): { headers: HttpHeaders } {
    let headers = new HttpHeaders();
    if (this.socket && this.socket.connected && this.socket.id) {
      headers = headers.set('X-Socket-Id', this.socket.id);
    }
    return { headers };
  }

  loadAlarms(): Observable<AppAlarm[]> {
    const headers = this.getAuthHeaders();
    return this.http.get<{ success: boolean, message: string, alarms: AppAlarm[] }>(this.apiUrl, { headers }).pipe(
      tap(apiResponse => {
        console.log('AlarmService: API response for loadAlarms (raw):', JSON.stringify(apiResponse));
      }),
      map(apiResponse => {
        if (apiResponse && Array.isArray(apiResponse.alarms)) {
          console.log(`AlarmService: loadAlarms API response contained ${apiResponse.alarms.length} alarms. Data: ${JSON.stringify(apiResponse.alarms)}`);
          this.alarmsSubject.next(apiResponse.alarms);
          return apiResponse.alarms;
        } else {
          console.warn('AlarmService: loadAlarms API response did not contain an alarms array or was invalid. Received:', apiResponse, 'Setting alarms to empty array.');
          this.alarmsSubject.next([]);
          return [];
        }
      }),
      catchError(error => {
        console.error(`AlarmService: Error loading alarms from API`, error);
        this.alarmsSubject.next([]);
        return throwError(() => new Error('Failed to load alarms from server.'));
      })
    );
  }

  getAlarms(): Observable<AppAlarm[]> {
    return this.alarmsSubject.asObservable();
  }

  getAlarm(id: number): Observable<AppAlarm | undefined> {
    const headers = this.getAuthHeaders();
    return this.http.get<AppAlarm>(`${this.apiUrl}/${id}`, { headers }).pipe(
      catchError(this.handleError)
    );
  }

  addAlarm(alarmData: Omit<AppAlarm, 'id'>): Observable<AppAlarm> {
    const headers = this.getAuthHeaders();
    return this.http.post<AppAlarm>(this.apiUrl, alarmData, { headers }).pipe(
      switchMap(async (newAlarm) => {
        return await this.scheduleNativeAlarmIfNeeded(newAlarm);
      }),
      tap((processedNewAlarm) => {
        const currentAlarms = this.alarmsSubject.getValue();
        if (!currentAlarms.find(a => a.id === processedNewAlarm.id)) {
            this.alarmsSubject.next([...currentAlarms, processedNewAlarm]);
        }
        this.showToast('Alarm created successfully', 'success');
      }),
      catchError(this.handleError)
    );
  }

  updateAlarm(id: number, alarmData: Partial<AppAlarm>): Observable<AppAlarm> {
    const headers = this.getAuthHeaders();
    return this.http.put<AppAlarm>(`${this.apiUrl}/${id}`, alarmData, { headers }).pipe(
      switchMap(async (updatedAlarmFromServer) => {
        const currentLocalAlarms = this.alarmsSubject.getValue();
        const localAlarmVersion = currentLocalAlarms.find(a => a.id === updatedAlarmFromServer.id);
        const alarmToProcess: AppAlarm = { ...updatedAlarmFromServer, nativeAlarmId: localAlarmVersion?.nativeAlarmId };
        return await this.scheduleNativeAlarmIfNeeded(alarmToProcess);
      }),
      tap(() => {
        this.showToast('Alarm updated successfully', 'success');
      }),
      catchError(this.handleError)
    );
  }

  deleteAlarm(id: number): Observable<void> {
    const headers = this.getAuthHeaders();
    const currentAlarms = this.alarmsSubject.getValue();
    const alarmToDelete = currentAlarms.find(alarm => alarm.id === id);

    return from(
      alarmToDelete && alarmToDelete.nativeAlarmId
        ? this.cancelNativeAlarmByNativeId(alarmToDelete.nativeAlarmId)
        : Promise.resolve()
    ).pipe(
      switchMap(() => this.http.delete<void>(`${this.apiUrl}/${id}`, { headers })),
      tap(() => {
        const currentAlarmsAfterDelete = this.alarmsSubject.getValue();
        const updatedAlarms = currentAlarmsAfterDelete.filter(alarm => alarm.id !== id);
        this.alarmsSubject.next(updatedAlarms);
        this.showSuccessToast('Alarm deleted successfully.');
      }),
      catchError(this.handleError)
    );
  }

  toggleAlarm(id: number, isActive: boolean): Observable<AppAlarm> {
    const headers = this.getAuthHeaders();
    return this.http.put<AppAlarm>(`${this.apiUrl}/${id}/toggle`, { isActive }, { headers }).pipe(
      switchMap(async (updatedAlarmFromServer) => {
        const currentLocalAlarms = this.alarmsSubject.getValue();
        const localAlarmVersion = currentLocalAlarms.find(a => a.id === updatedAlarmFromServer.id);
        const alarmToProcess: AppAlarm = { ...updatedAlarmFromServer, nativeAlarmId: localAlarmVersion?.nativeAlarmId };
        return await this.scheduleNativeAlarmIfNeeded(alarmToProcess);
      }),
      tap((processedAlarm) => {
        this.showSuccessToast(`Alarm ${processedAlarm.isActive ? 'activated' : 'deactivated'}.`);
      }),
      catchError(this.handleError)
    );
  }

  syncAlarms(): Observable<AppAlarm[]> {
    const headers = this.getAuthHeaders();
    const currentAlarms = this.alarmsSubject.getValue();
    console.log('AlarmService: syncAlarms called. Sending current alarms to backend:', currentAlarms);
    return this.http.post<{ success: boolean, message: string, alarms: AppAlarm[] }>(`${this.apiUrl}/sync`, { alarms: currentAlarms }, { headers }).pipe(
      map(response => {
        if (response && Array.isArray(response.alarms)) {
          console.log('AlarmService: syncAlarms successful. Received from backend (raw):', JSON.stringify(response));
          console.log('AlarmService: Extracted alarms from sync response:', response.alarms);
          return response.alarms;
        } else {
          console.warn('AlarmService: syncAlarms response did not contain a valid alarms array. Received:', JSON.stringify(response));
          throw new Error('Invalid response structure from syncAlarms endpoint. Expected an object with an "alarms" array.');
        }
      }),
      tap(extractedAlarms => {
        this.alarmsSubject.next(extractedAlarms);
        console.log('AlarmService: Re-scheduling native alarms after sync.');
        extractedAlarms.forEach(alarm => this.scheduleNativeAlarmIfNeeded(alarm));
        this.showToast('Alarms synced successfully with server.', 'success');
      }),
      catchError(error => {
        return this.handleError(error);
      })
    );
  }

  private async showUserToast(message: string, color: 'success' | 'danger' | 'warning', duration: number = 2000) {
    const toast = await this.toastController.create({
      message: message,
      duration: duration,
      color: color,
      position: 'bottom'
    });
    toast.present();
  }

  private showErrorToast(message: string) {
    this.showUserToast(message, 'danger', 3000);
  }

  private showSuccessToast(message: string) {
    this.showUserToast(message, 'success', 2000);
  }

  private showToast(message: string, color: 'success' | 'danger' | 'warning') {
    this.showUserToast(message, color);
  }

  private handleError(error: HttpErrorResponse | Error) {
    console.error('API or Client-side Error occurred:', error);
    let userMessage = 'An unknown error occurred!';

    if (error instanceof HttpErrorResponse) {
      userMessage = `Backend error: Status ${error.status} (${error.statusText || 'Status text not available'})`;
      if (error.error) {
        if (typeof error.error === 'object') {
          let detail = error.error.message || error.error.error || error.error.detail;
          if (typeof detail === 'object') {
            try {
              detail = JSON.stringify(detail);
            } catch (e) {
              detail = 'Unserializable error object';
            }
          }
          if (detail) {
            userMessage += ` - Message: ${detail}`;
          } else {
            try {
              userMessage += ` - Details: ${JSON.stringify(error.error)}`;
            } catch (e) {
              userMessage += ' - Details: Unserializable error content';
            }
          }
        } else if (typeof error.error === 'string') {
          userMessage += ` - Message: ${error.error}`;
        }
      } else if (error.message) {
        userMessage += ` - ${error.message}`;
      }
    } else {
      userMessage = error.message || 'An unexpected client-side error occurred during the operation.';
    }

    console.error('AlarmService: User-facing error message:', userMessage);
    this.showErrorToast(userMessage);
    return throwError(() => new Error(userMessage));
  }

  private getAuthHeaders(): HttpHeaders {
    let headers = new HttpHeaders();
    const token = this.authService.getAccessToken();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  }

  private updateAlarmInSubject(updatedAlarm: AppAlarm): void {
    const currentAlarms = this.alarmsSubject.getValue();
    const index = currentAlarms.findIndex(a => a.id === updatedAlarm.id);
    if (index !== -1) {
      currentAlarms[index] = { ...currentAlarms[index], ...updatedAlarm };
      this.alarmsSubject.next([...currentAlarms]);
    } else {
      console.log(`AlarmService: updateAlarmInSubject - Alarm with id ${updatedAlarm.id} not found, adding to subject.`);
      this.alarmsSubject.next([...currentAlarms, updatedAlarm]);
    }
  }
  
  private calculateNextAlarmTimestamp(timeStr: string, daysOfWeek: number[] | undefined, noRepeat?: boolean): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = new Date();
    // Ensure daysOfWeek is an array for consistent logging and processing
    const currentDaysOfWeek = Array.isArray(daysOfWeek) ? daysOfWeek : [];
    console.log(`AlarmService: calculateNextAlarmTimestamp - INPUTS: timeStr=${timeStr}, daysOfWeek=${JSON.stringify(currentDaysOfWeek)}, noRepeat=${noRepeat}, now=${now.toISOString()}`);
  
    if (noRepeat || !currentDaysOfWeek || currentDaysOfWeek.length === 0) {
      let alarmTime = new Date(now);
      alarmTime.setHours(hours, minutes, 0, 0);
      if (alarmTime.getTime() <= now.getTime()) {
        alarmTime.setDate(now.getDate() + 1);
      }
      console.log(`AlarmService: calculateNextAlarmTimestamp (one-time/no days) for ${timeStr}. Calculated: ${alarmTime.toISOString()} (${alarmTime.getTime()})`);
      return alarmTime.getTime();
    }
  
    const sortedDays = [...currentDaysOfWeek].sort((a, b) => a - b);
  
    for (let i = 0; i < 7; i++) {
      const potentialAlarmDate = new Date(now);
      potentialAlarmDate.setDate(now.getDate() + i);
      potentialAlarmDate.setHours(hours, minutes, 0, 0);
      const dayOfWeekForPotentialDate = potentialAlarmDate.getDay();
  
      if (sortedDays.includes(dayOfWeekForPotentialDate)) {
        if (potentialAlarmDate.getTime() > now.getTime()) {
          console.log(`AlarmService: calculateNextAlarmTimestamp (repeating, current week cycle) for ${timeStr}, days ${sortedDays.join(',')}. Found: ${potentialAlarmDate.toISOString()} (${potentialAlarmDate.getTime()})`);
          return potentialAlarmDate.getTime();
        }
      }
    }
  
    console.log(`AlarmService: calculateNextAlarmTimestamp (repeating) - No slot found in current week cycle for ${timeStr}, days ${sortedDays.join(',')}. Looking for next cycle.`);
    if (sortedDays.length > 0) {
      let firstDayInPattern = sortedDays[0];
      let currentDayOfWeek = now.getDay();
      
      let daysToAdd = (firstDayInPattern - currentDayOfWeek + 7) % 7;
      // If daysToAdd is 0 and the alarm time for today has already passed, schedule for next week's occurrence of this day.
      const tempCheckDate = new Date(now);
      tempCheckDate.setDate(now.getDate() + daysToAdd);
      tempCheckDate.setHours(hours, minutes, 0, 0);
      if (daysToAdd === 0 && tempCheckDate.getTime() <= now.getTime()) {
        daysToAdd = 7;
      }
      
      const nextOccurrenceDate = new Date(now);
      nextOccurrenceDate.setDate(now.getDate() + daysToAdd);
      nextOccurrenceDate.setHours(hours, minutes, 0, 0);
      
      console.log(`AlarmService: calculateNextAlarmTimestamp (repeating, advanced to next cycle) for ${timeStr}, days ${sortedDays.join(',')}. Calculated: ${nextOccurrenceDate.toISOString()} (${nextOccurrenceDate.getTime()})`);
      return nextOccurrenceDate.getTime();
    }
  
    console.warn(`AlarmService: calculateNextAlarmTimestamp - Could not find a future slot for repeating alarm ${timeStr} on days ${currentDaysOfWeek.join(',')}. Returning 0.`);
    return 0;
  }

  private async scheduleNativeAlarmIfNeeded(alarmInput: AppAlarm): Promise<AppAlarm> {
    // Simplified initial log to ensure it always runs if function is entered.
    console.log(`AlarmService: scheduleNativeAlarmIfNeeded ENTRY - ID: ${alarmInput?.id}, Active: ${alarmInput?.isActive}, Time: ${alarmInput?.time}, Days (raw): ${JSON.stringify(alarmInput?.days)}, NoRepeat: ${alarmInput?.noRepeat}`);

    const alarm = { ...alarmInput }; // Work with a copy    // ** Normalize alarm.days **
    if (typeof alarm.days === 'string') {
      try {
        const parsedDays = JSON.parse(alarm.days);
        if (Array.isArray(parsedDays) && parsedDays.every(d => typeof d === 'number')) {
          alarm.days = parsedDays;
          console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Normalized alarm.days from string to number[]: ${JSON.stringify(alarm.days)} for alarm ID ${alarm.id}`);
        } else {
          console.warn(`AlarmService: scheduleNativeAlarmIfNeeded - alarm.days was string but not valid JSON array of numbers: "${alarm.days}". Treating as empty for alarm ID ${alarm.id}.`);
          alarm.days = [];
        }
      } catch (e) {
        console.warn(`AlarmService: scheduleNativeAlarmIfNeeded - Failed to JSON.parse alarm.days string: "${alarm.days}". Treating as empty for alarm ID ${alarm.id}. Error:`, e);
        alarm.days = [];
      }
    } else if (alarm.days === undefined || alarm.days === null) {
      // If days is undefined or null, ensure it's an empty array for consistency
      console.log(`AlarmService: scheduleNativeAlarmIfNeeded - alarm.days was ${alarm.days}. Initializing to empty array for alarm ID ${alarm.id}.`);
      alarm.days = [];
    } else if (!Array.isArray(alarm.days)) {
      console.warn(`AlarmService: scheduleNativeAlarmIfNeeded - alarm.days is unexpected type: ${typeof alarm.days}. Value: ${JSON.stringify(alarm.days)}. Treating as empty for alarm ID ${alarm.id}.`);
      alarm.days = [];
    }
    // At this point, alarm.days should be a number[]
    
    // If days array is empty or undefined, ensure this is marked as a non-repeating alarm
    if (!alarm.days || alarm.days.length === 0) {
      if (alarm.noRepeat !== true) {
        console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Alarm ${alarm.id} has no days selected. Setting noRepeat=true.`);
        alarm.noRepeat = true;
        
        // If the alarm is active, update it in the backend to ensure consistency
        if (alarm.isActive && alarm.id) {
          console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Updating backend to set noRepeat=true for alarm ${alarm.id}`);
          // Use a setTimeout to avoid blocking the current operation
          setTimeout(() => {
            this.updateAlarm(alarm.id!, { noRepeat: true }).subscribe({
              next: (updatedAlarm) => {
                console.log(`AlarmService: Auto-updated noRepeat for alarm ${alarm.id} in backend`);
              },
              error: (error) => {
                console.error(`AlarmService: Failed to auto-update noRepeat for alarm ${alarm.id}:`, error);
              }
            });
          }, 0);
        }
      }
    }
  
    if (!alarm.id) {
      console.warn('AlarmService: scheduleNativeAlarmIfNeeded - EXITING: no alarm.id.', JSON.parse(JSON.stringify(alarm)));
      if (alarm.nativeAlarmId) {
         console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Cancelling native alarm ${alarm.nativeAlarmId} due to missing alarm.id.`);
         await this.cancelNativeAlarmByNativeId(alarm.nativeAlarmId);
         alarm.nativeAlarmId = undefined;
      }
      this.updateAlarmInSubject(alarm);
      return alarm;
    }
    console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Proceeding with alarm.id: ${alarm.id}. Normalized days: ${JSON.stringify(alarm.days)}`);
  
    if (!alarm.isActive) {
      console.log(`AlarmService: scheduleNativeAlarmIfNeeded - EXITING: alarm ${alarm.id} is not active.`);
      if (alarm.nativeAlarmId) {
        console.log(`AlarmService: Alarm ${alarm.id} is inactive, cancelling native alarm ${alarm.nativeAlarmId}`);
        await this.cancelNativeAlarmByNativeId(alarm.nativeAlarmId);
        alarm.nativeAlarmId = undefined;
      }
      this.updateAlarmInSubject(alarm);
      return alarm;
    }
    console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Alarm ${alarm.id} is active.`);
  
    if (alarm.nativeAlarmId) {
      try {
        console.log(`AlarmService: Attempting to cancel existing native alarm ${alarm.nativeAlarmId} before rescheduling for backend alarm ${alarm.id}`);
        await this.alarmManagerService.cancelNativeAlarm({ alarmId: alarm.nativeAlarmId });
      } catch (e) {
        console.warn(`AlarmService: Failed to cancel existing native alarm ${alarm.nativeAlarmId}. Error:`, e);
      }
    }
  
    const newNativeAlarmId = `timely-${alarm.id}`;
    console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Calculating next timestamp for alarm ${alarm.id} (Native ID to be: ${newNativeAlarmId}) with time: ${alarm.time}, days: ${JSON.stringify(alarm.days)}, noRepeat: ${alarm.noRepeat}`);
    const nextTimestamp = this.calculateNextAlarmTimestamp(alarm.time, alarm.days, alarm.noRepeat);
    
    let timestampIsoForLog = 'Invalid/Past/NaN';
    if (typeof nextTimestamp === 'number' && !isNaN(nextTimestamp) && nextTimestamp > 0) {
      try {
        timestampIsoForLog = new Date(nextTimestamp).toISOString();
      } catch (e) { timestampIsoForLog = 'Error converting to ISOString'; }
    }
    console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Calculated nextTimestamp for alarm ${alarm.id}: ${nextTimestamp} (${timestampIsoForLog})`);
  
    if (isNaN(nextTimestamp) || nextTimestamp === 0) {
      console.log(`AlarmService: scheduleNativeAlarmIfNeeded - EXITING: No valid future time (0 or NaN) calculated for active alarm ${alarm.id}. Timestamp: ${nextTimestamp}`);
      if (alarm.nativeAlarmId) { 
          console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Cancelling previously known native alarm ${alarm.nativeAlarmId} for ${alarm.id} as no new time could be found.`);
          await this.cancelNativeAlarmByNativeId(alarm.nativeAlarmId);
      }
      alarm.nativeAlarmId = undefined;
      this.updateAlarmInSubject(alarm);
      return alarm;
    }
    console.log(`AlarmService: scheduleNativeAlarmIfNeeded - Valid future time ${nextTimestamp} for alarm ${alarm.id}. Proceeding to schedule with native ID ${newNativeAlarmId}.`);
  
    const config: AlarmConfig = {
      alarmId: newNativeAlarmId,
      at: nextTimestamp,
      name: `Alarm: ${alarm.title || 'Untitled Alarm'}`,
      exact: true,
      extra: { backendAlarmId: alarm.id, title: alarm.title || 'Untitled Alarm', sound: alarm.sound, volume: alarm.volume },
      uiOptions: { titleText: alarm.title || 'Alarm', alarmNameText: alarm.time }
    };
  
    try {
      let scheduleTimestampIsoForLog = 'Invalid/Error';
      if (typeof config.at === 'number' && !isNaN(config.at) && config.at > 0) {
        try { scheduleTimestampIsoForLog = new Date(config.at).toISOString(); } catch (e) { scheduleTimestampIsoForLog = 'Error converting to ISOString'; }
      }
      console.log(`AlarmService: Scheduling native alarm for backend alarm ${alarm.id} with native ID ${newNativeAlarmId} at ${scheduleTimestampIsoForLog}`, JSON.parse(JSON.stringify(config)));
      const result = await this.alarmManagerService.setNativeAlarm(config);
      alarm.nativeAlarmId = result.alarmId; 
      console.log(`AlarmService: Successfully scheduled native alarm ${result.alarmId} for backend alarm ${alarm.id}`);
    } catch (error) {
      console.error(`AlarmService: Failed to schedule native alarm for backend alarm ${alarm.id} (native ID ${newNativeAlarmId})`, error);
      alarm.nativeAlarmId = undefined; 
    }
    this.updateAlarmInSubject(alarm);
    return alarm;
  }
  
  private async cancelNativeAlarmByNativeId(nativeId: string): Promise<void> {
     try {
        console.log(`AlarmService: Cancelling native alarm with ID: ${nativeId}`);
        await this.alarmManagerService.cancelNativeAlarm({ alarmId: nativeId });
        console.log(`AlarmService: Successfully cancelled native alarm ${nativeId}`);
      } catch (error) {
        console.error(`AlarmService: Failed to cancel native alarm ${nativeId}`, error);
      }
  }

  private async cancelNativeAlarmByBackendId(backendAlarmId: number): Promise<void> {
    const currentAlarms = this.alarmsSubject.getValue();
    const alarmToCancel = currentAlarms.find(a => a.id === backendAlarmId);
    if (alarmToCancel && alarmToCancel.nativeAlarmId) {
      await this.cancelNativeAlarmByNativeId(alarmToCancel.nativeAlarmId);
      alarmToCancel.nativeAlarmId = undefined; 
      this.updateAlarmInSubject(alarmToCancel); 
    } else {
      const potentialNativeId = `timely-${backendAlarmId}`;
      console.log(`AlarmService: Alarm with backend ID ${backendAlarmId} not in subject or no nativeAlarmId. Attempting cancel with constructed ID ${potentialNativeId}`);
      await this.cancelNativeAlarmByNativeId(potentialNativeId);
    }
  }

  private async cancelAllNativeAlarms(): Promise<void> {
    console.log('AlarmService: Cancelling all native alarms on logout/disconnect.');
    const currentAlarms = this.alarmsSubject.getValue(); 
    for (const alarm of currentAlarms) {
      if (alarm.nativeAlarmId) {
        await this.cancelNativeAlarmByNativeId(alarm.nativeAlarmId);
      }
    }
  }
  /**
   * Set up a listener for alarm triggers to handle one-time alarms
   * Called from the AppComponent to automatically disable non-repeating alarms
   * @returns A promise that resolves when the listener is set up
   */
  setupAlarmTriggerListener(): Promise<void> {
    console.log('AlarmService: Setting up alarm trigger listener');
    
    return new Promise<void>(async (resolve, reject) => {
      try {
        // We need to listen for 'alarmDismissed' event instead of 'alarm_triggered' based on the logs
        const listenerHandle = await this.alarmManagerService.listenToAlarmTriggers('alarmDismissed', async (eventData) => {
          console.log('AlarmService: Alarm dismissed:', eventData);
          
          // Parse the alarmId to extract the backend alarm ID
          // Format is "timely-X" where X is the backend alarm ID
          const alarmIdStr = eventData.alarmId || '';
          let backendAlarmId: number | undefined = undefined;
          
          if (alarmIdStr.startsWith('timely-')) {
            backendAlarmId = parseInt(alarmIdStr.substring(7), 10);
          } else if (eventData.extra && eventData.extra.backendAlarmId !== undefined) {
            // Fallback to extra data if available
            backendAlarmId = eventData.extra.backendAlarmId;
          }
          
          console.log(`AlarmService: Extracted backend alarm ID: ${backendAlarmId} from native ID: ${alarmIdStr}`);
          
          if (backendAlarmId !== undefined && !isNaN(backendAlarmId)) {
            console.log(`AlarmService: Processing dismissed alarm with backend ID: ${backendAlarmId}`);
            
            // Get the alarm details to check if it's a non-repeating alarm            
            const currentAlarms = this.alarmsSubject.getValue();
            const triggeredAlarm = currentAlarms.find(alarm => alarm.id === backendAlarmId);
            
            // Log detailed alarm information for debugging
            this.logAlarmDetails(backendAlarmId, 'alarmDismissed');
            
            // Use our dedicated method to check if this is a one-time alarm
            const isOneTime = this.isOneTimeAlarm(triggeredAlarm);
            
            console.log(`AlarmService: Is alarm ${backendAlarmId} a one-time alarm? ${isOneTime}`);
            
            if (triggeredAlarm && isOneTime) {
              console.log(`AlarmService: Alarm ${backendAlarmId} is a one-time alarm. Disabling it.`);
              
              try {
                // Disable the alarm by setting isActive to false
                this.toggleAlarm(backendAlarmId, false).subscribe({
                  next: (updatedAlarm) => {
                    console.log(`AlarmService: Successfully disabled one-time alarm ${backendAlarmId}`, updatedAlarm);
                    // Update UI with a toast notification
                    this.showToast('One-time alarm has been automatically disabled.', 'success');
                  },
                  error: (error) => {
                    console.error(`AlarmService: Error disabling one-time alarm ${backendAlarmId}:`, error);
                  }
                });
              } catch (error) {
                console.error(`AlarmService: Error processing one-time alarm ${backendAlarmId}:`, error);
              }
            } else {
              console.log(`AlarmService: Alarm ${backendAlarmId} is not a one-time alarm or was not found. No action needed.`);
            }
          } else {
            console.warn('AlarmService: Could not extract backend alarm ID from event data:', eventData);
          }
        });
        
        console.log('AlarmService: Alarm trigger listener setup successfully');
        resolve();
      } catch (error) {
        console.error('AlarmService: Failed to set up alarm trigger listener:', error);
        reject(error);
      }
    });
  }

  /**
   * Set up redundant listeners for alarm events to ensure we catch all possible events
   * That could indicate an alarm has triggered or been dismissed
   * @returns A promise that resolves when all listeners are set up
   */
  setupMultipleAlarmEventListeners(): Promise<void> {
    console.log('AlarmService: Setting up multiple alarm event listeners');
    
    return Promise.all([
      this.setupAlarmTriggerListener(),
      this.setupAlarmTriggeredListener()
    ]).then(() => {
      console.log('AlarmService: All alarm event listeners set up successfully');
    }).catch(error => {
      console.error('AlarmService: Error setting up some alarm event listeners:', error);
      // We still resolve the promise even if some listeners failed
    });
  }
  
  /**
   * Set up a listener specifically for the alarm_triggered event
   * This provides redundancy in case alarmDismissed isn't fired
   * @returns A promise that resolves when the listener is set up
   */
  private setupAlarmTriggeredListener(): Promise<void> {
    console.log('AlarmService: Setting up alarm_triggered event listener');
    
    return new Promise<void>(async (resolve, reject) => {
      try {
        const listenerHandle = await this.alarmManagerService.listenToAlarmTriggers('alarm_triggered', async (eventData) => {
          console.log('AlarmService: Alarm triggered event received:', eventData);
          
          if (eventData.extra && eventData.extra.backendAlarmId !== undefined) {
            const backendAlarmId = eventData.extra.backendAlarmId;
            console.log(`AlarmService: Processing triggered alarm with backend ID: ${backendAlarmId}`);
            
            // Get the alarm details to check if it's a non-repeating alarm
            const currentAlarms = this.alarmsSubject.getValue();
            const triggeredAlarm = currentAlarms.find(alarm => alarm.id === backendAlarmId);
            
            // Log detailed alarm information
            this.logAlarmDetails(backendAlarmId, 'alarm_triggered');
            
            // Use our dedicated method to check if this is a one-time alarm
            const isOneTime = this.isOneTimeAlarm(triggeredAlarm);
            
            console.log(`AlarmService: Is alarm ${backendAlarmId} a one-time alarm? ${isOneTime}`);
            
            if (triggeredAlarm && isOneTime) {
              console.log(`AlarmService: Alarm ${backendAlarmId} is a one-time alarm. Disabling it.`);
              
              try {
                // Disable the alarm by setting isActive to false
                this.toggleAlarm(backendAlarmId, false).subscribe({
                  next: (updatedAlarm) => {
                    console.log(`AlarmService: Successfully disabled one-time alarm ${backendAlarmId}`, updatedAlarm);
                    // Update UI with a toast notification
                    this.showToast('One-time alarm has been automatically disabled.', 'success');
                  },
                  error: (error) => {
                    console.error(`AlarmService: Error disabling one-time alarm ${backendAlarmId}:`, error);
                  }
                });
              } catch (error) {
                console.error(`AlarmService: Error processing one-time alarm ${backendAlarmId}:`, error);
              }
            } else {
              console.log(`AlarmService: Alarm ${backendAlarmId} is not a one-time alarm or was not found. No action needed.`);
            }
          } else {
            console.warn('AlarmService: Received alarm trigger without backendAlarmId in extra data:', eventData);
          }
        });
        
        console.log('AlarmService: alarm_triggered event listener setup successfully');
        resolve();
      } catch (error) {
        console.error('AlarmService: Failed to set up alarm_triggered event listener:', error);
        reject(error);
      }
    });
  }

  /**
   * Log detailed information about an alarm for debugging purposes
   * @param alarmId The backend ID of the alarm
   * @param context Additional context information
   */  private logAlarmDetails(alarmId: number, context: string = 'general'): void {
    const allAlarms = this.alarmsSubject.getValue();
    const alarm = allAlarms.find(a => a.id === alarmId);
    
    if (alarm) {
      // Normalize days for logging with enhanced error handling
      let daysArray = [];
      let parseError = null;
        if (typeof alarm.days === 'string') {
        try {
          const parsed = JSON.parse(alarm.days);
          daysArray = Array.isArray(parsed) ? parsed : [];
        } catch (e: any) {
          parseError = e.message || 'Unknown parsing error';
          daysArray = [];
        }
      } else if (Array.isArray(alarm.days)) {
        daysArray = alarm.days;
      }
      
      // Check if this should be a one-time alarm based on days
      const hasNoDays = daysArray.length === 0;
      const shouldBeNoRepeat = hasNoDays;
      const isCurrentlyNoRepeat = alarm.noRepeat === true;
      
      console.log(`AlarmService: [${context}] Alarm details for ID ${alarmId}:`, {
        id: alarm.id,
        title: alarm.title,
        time: alarm.time,
        days: daysArray,
        daysRaw: alarm.days,
        daysType: typeof alarm.days,
        daysParseError: parseError,
        hasNoDays: hasNoDays,
        isActive: alarm.isActive,
        noRepeat: alarm.noRepeat,
        isCurrentlyNoRepeat: isCurrentlyNoRepeat,
        shouldBeNoRepeat: shouldBeNoRepeat,
        mismatchedNoRepeatFlag: shouldBeNoRepeat !== isCurrentlyNoRepeat,
        willBeDetectedAsOneTime: isCurrentlyNoRepeat || hasNoDays,
        nativeAlarmId: alarm.nativeAlarmId,
        syncStatus: alarm.syncStatus
      });
      
      // If there's a mismatch between days and noRepeat flag, log a warning
      if (shouldBeNoRepeat && !alarm.noRepeat) {
        console.warn(`AlarmService: [${context}] Alarm ${alarmId} has no days but noRepeat is false. This is inconsistent.`);
      }
    } else {
      console.log(`AlarmService: [${context}] No alarm found with ID ${alarmId}`);
    }
  }

  /**
   * Fix any inconsistencies in alarm configuration
   * Ensures alarms with no days are marked as noRepeat=true
   */  private fixAlarmInconsistencies(alarms: AppAlarm[]): void {
    console.log('AlarmService: Checking for alarm configuration inconsistencies');
    
    for (const alarm of alarms) {
      // Normalize days array with enhanced error handling
      let daysArray: number[] = [];
      let parseError = null;
      
      if (typeof alarm.days === 'string') {        try {
          const parsed = JSON.parse(alarm.days);
          if (Array.isArray(parsed)) {
            daysArray = parsed;
          } else {
            console.warn(`AlarmService: Days property for alarm ${alarm.id} is not an array after parsing:`, alarm.days);
            daysArray = [];
          }
        } catch (e: any) {
          parseError = e.message || 'Unknown parsing error';
          console.warn(`AlarmService: Failed to parse days for alarm ${alarm.id}: ${parseError}, raw value:`, alarm.days);
          daysArray = [];
        }
      } else if (Array.isArray(alarm.days)) {
        daysArray = alarm.days;
      } else if (alarm.days === undefined || alarm.days === null) {
        console.warn(`AlarmService: Days property for alarm ${alarm.id} is ${alarm.days}`);
        daysArray = [];
      } else {
        console.warn(`AlarmService: Unexpected days property type for alarm ${alarm.id}:`, typeof alarm.days);
        daysArray = [];
      }
      
      // Check if this should be a noRepeat alarm (no days selected)
      const hasNoDays = daysArray.length === 0;
      
      // If it has no days but noRepeat is false, fix it
      if (hasNoDays && alarm.noRepeat === false && alarm.id) {
        console.log(`AlarmService: Found inconsistency - Alarm ${alarm.id} has no days but noRepeat=false. Fixing...`);
        
        // Update the alarm locally
        alarm.noRepeat = true;
        
        // Update in backend
        this.updateAlarm(alarm.id, { noRepeat: true }).subscribe({
          next: (updated) => console.log(`AlarmService: Successfully fixed noRepeat inconsistency for alarm ${alarm.id}`),
          error: (err) => console.error(`AlarmService: Error fixing noRepeat inconsistency for alarm ${alarm.id}:`, err)
        });
      }
    }
  }

  /**
   * Determines if an alarm should be treated as a one-time (non-repeating) alarm
   * @param alarm The alarm to check
   * @returns true if the alarm is one-time, false otherwise
   */
  private isOneTimeAlarm(alarm: AppAlarm | undefined): boolean {
    if (!alarm) {
      return false;
    }
    
    // If noRepeat flag is explicitly set to true, it's a one-time alarm
    if (alarm.noRepeat === true) {
      return true;
    }
    
    // Check if the days property indicates a one-time alarm (empty array)
    const days = alarm.days;
    let daysArray: any[] = [];
    
    if (typeof days === 'string') {
      // Common string patterns that represent empty arrays
      if (days === '[]' || days === '' || days === '""' || days === 'null') {
        return true;
      }
      
      // Try to parse JSON
      try {
        const parsed = JSON.parse(days);
        daysArray = Array.isArray(parsed) ? parsed : [];
      } catch (e: any) {
        // If parsing fails, treat as empty
        return true;
      }
    } else if (Array.isArray(days)) {
      daysArray = days;
    }
    
    // If days array is empty, it's a one-time alarm
    return daysArray.length === 0;
  }
}