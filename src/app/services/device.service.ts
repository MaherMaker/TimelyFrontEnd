import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service'; // Assuming AuthService provides deviceId and token

interface DeviceRegistrationPayload {
  device_id: string;
  device_name: string;
  fcm_token: string;
}

interface DeviceRegistrationResponse {
  message: string;
  device?: any; // Define a proper device interface if needed
}

@Injectable({
  providedIn: 'root'
})
export class DeviceService {
  private apiUrl = `${environment.apiUrl}/devices`;
  private pendingFcmToken: string | null = null;
  private authSubscription: Subscription | undefined;

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {
    // Attempt to register pending token when user authenticates
    this.authSubscription = this.authService.accessToken$.pipe(
      filter(token => token !== null && this.pendingFcmToken !== null)
    ).subscribe(() => {
      console.log('DeviceService: Access token became available, attempting to register pending FCM token.');
      this.tryRegisterPendingToken();
    });
  }

  ngOnDestroy() {
    if (this.authSubscription) {
      this.authSubscription.unsubscribe();
    }
  }

  private async tryRegisterPendingToken(): Promise<void> {
    if (this.pendingFcmToken) {
      const tokenToRegister = this.pendingFcmToken;
      console.log('DeviceService: Attempting to register stored pending FCM token:', tokenToRegister);
      await this.actualRegisterDeviceToken(tokenToRegister, 'Mobile Device (Pending Registration)');
    }
  }

  async registerDeviceToken(fcmToken: string): Promise<void> {
    console.log('DeviceService: registerDeviceToken called with token:', fcmToken);
    this.pendingFcmToken = fcmToken;

    const deviceId = this.authService.getDeviceId();
    const accessToken = this.authService.getAccessToken();

    if (!deviceId) {
      console.error('DeviceService: Device ID not found. FCM token stored as pending.');
      return;
    }

    if (!accessToken) {
      console.error('DeviceService: Access token not found. FCM token stored as pending.');
      return;
    }

    console.log('DeviceService: Auth info available, proceeding with immediate registration for token:', fcmToken);
    this.pendingFcmToken = null;
    await this.actualRegisterDeviceToken(fcmToken, 'Mobile Device');
  }

  private async actualRegisterDeviceToken(fcmToken: string, deviceName: string): Promise<void> {
    const deviceId = this.authService.getDeviceId();
    const accessToken = this.authService.getAccessToken();

    if (!deviceId || !accessToken) {
      console.error('DeviceService (actualRegister): Device ID or Access Token became null. Aborting.');
      this.pendingFcmToken = fcmToken;
      return;
    }

    const payload: DeviceRegistrationPayload = {
      device_id: deviceId,
      device_name: deviceName,
      fcm_token: fcmToken
    };

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`
    });

    try {
      const response = await firstValueFrom(
        this.http.post<DeviceRegistrationResponse>(`${this.apiUrl}/register`, payload, { headers })
      );
      console.log('DeviceService: Device token registered successfully via actualRegisterDeviceToken', response);
    } catch (error) {
      console.error('DeviceService: Error registering device token via actualRegisterDeviceToken', error);
      this.pendingFcmToken = fcmToken;
    }
  }

  async updateDeviceFcmToken(fcmToken: string): Promise<void> {
    const deviceId = this.authService.getDeviceId();
    const accessToken = this.authService.getAccessToken();

    if (!deviceId || !accessToken) {
      console.error('DeviceService: Device ID or Access Token not found. Cannot update FCM token.');
      return;
    }

    const payload = {
      device_id: deviceId,
      fcm_token: fcmToken
    };

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`
    });

    try {
      const response = await firstValueFrom(
        this.http.put<DeviceRegistrationResponse>(`${this.apiUrl}/fcm-token`, payload, { headers })
      );
      console.log('DeviceService: Device FCM token updated successfully', response);
    } catch (error) {
      console.error('DeviceService: Error updating device FCM token', error);
    }
  }
}
