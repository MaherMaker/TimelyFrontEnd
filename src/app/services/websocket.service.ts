import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { Alarm } from '../models/alarm.model';
import { AuthService } from './auth.service';

// Define interfaces for WebSocket event data
interface AlarmDeletedData {
  id: number;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private socket: Socket | undefined;
  private currentSocketId: string | undefined; // Store socket.id
  private isConnected = false;

  // Subjects for different alarm events
  private alarmCreatedSource = new Subject<Alarm>();
  private alarmUpdatedSource = new Subject<Alarm>();
  private alarmDeletedSource = new Subject<AlarmDeletedData>(); // Use specific type

  // Observables for components to subscribe to
  alarmCreated$ = this.alarmCreatedSource.asObservable();
  alarmUpdated$ = this.alarmUpdatedSource.asObservable();
  alarmDeleted$ = this.alarmDeletedSource.asObservable();

  constructor(private authService: AuthService) {
    // Subscribe to isAuthenticated$ to manage connection state
    this.authService.isAuthenticated$.subscribe((isAuthenticated) => {
      if (isAuthenticated && !this.isConnected) {
        const token = this.authService.getAccessToken(); // Get current token
        const deviceId = this.authService.getDeviceId(); // Get deviceId
        if (token && deviceId) { // Ensure both token and deviceId are present
          this.connect(token, deviceId);
        } else {
          console.warn('WebSocketService: Authenticated but no token or deviceId found. Cannot connect.');
        }
      } else if (!isAuthenticated && this.isConnected) {
        this.disconnect();
      }
    });
  }

  public getSocketId(): string | undefined { // Getter for socket.id
    return this.currentSocketId;
  }

  private connect(token: string, deviceId: string): void { // Add deviceId as parameter
    if (this.socket?.connected) {
      console.log('WebSocketService: Already connected.'); // Added service name for clarity
      return;
    }

    console.log('WebSocketService: Attempting to connect with token and deviceId...'); // Added service name
    const baseUrl = environment.apiUrl.replace('/api', ''); 
    this.socket = io(baseUrl, { 
      auth: { token }, // This sends the token correctly
      query: { deviceId }, // Add deviceId here
      transports: ['websocket'],
      // Consider adding reconnection options if default behavior is not ideal
      // reconnectionAttempts: 5,
      // reconnectionDelay: 3000,
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.currentSocketId = this.socket?.id; // Store socket.id
      console.log('WebSocketService: Connected - ID:', this.currentSocketId); // Added service name
      this.setupEventListeners();
    });

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      this.currentSocketId = undefined; // Clear socket.id
      console.log('WebSocketService: Disconnected - Reason:', reason); // Added service name
      // If the disconnection was not intentional (e.g., server down, token invalid on server side)
      // and the user is still marked as authenticated on the client,
      // we might want to attempt a reconnect or re-evaluate auth status.
      // For now, if authService.isAuthenticated$ becomes false, disconnect() is called.
      // If it's still true, a new connection will be attempted if a new token becomes available.
    });

    this.socket.on('connect_error', (error: any) => { // Changed type of error to any
      console.error('WebSocketService: Connection Error -', error.message, error.data || ''); // Added service name and more error details
      this.isConnected = false;
      this.currentSocketId = undefined; // Clear socket.id on connection error too
      // If connect_error is due to auth, the backend should ideally disconnect.
      // The authService.isAuthenticated$ might eventually become false if token refresh fails,
      // which would trigger a disconnect here.
      // Consider specific handling for auth errors if the server sends them clearly.
    });

    this.socket.on('error', (error) => {
       console.error('WebSocketService: Server Error -', error); // Added service name
     });
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    // Listen for alarm events from the server
    this.socket.on('alarm_created', (alarm: Alarm) => {
      console.log('WebSocketService: Received alarm_created:', alarm); // Added service name
      this.alarmCreatedSource.next(alarm);
    });

    this.socket.on('alarm_updated', (alarm: Alarm) => {
      console.log('WebSocketService: Received alarm_updated:', alarm); // Added service name
      this.alarmUpdatedSource.next(alarm);
    });

    this.socket.on('alarm_deleted', (data: AlarmDeletedData) => {
      console.log('WebSocketService: Received alarm_deleted:', data); // Added service name
      this.alarmDeletedSource.next(data);
    });

     // Example: Listen for a generic notification
     this.socket.on('notification', (message: string) => {
       console.log('WebSocketService: Received notification:', message); // Added service name
       // Handle notification, e.g., show a toast
     });
  }

  disconnect(): void {
    if (this.socket) {
      console.log('WebSocketService: Disconnecting...'); // Added service name
      this.socket.disconnect();
      // No need to set this.socket = undefined here, disconnect event will handle isConnected
    }
  }

  // Optional: Method to manually emit an event (if needed for client-side actions)
  // emitEvent(eventName: string, data: any): void {
  //   if (this.socket?.connected) {
  //     this.socket.emit(eventName, data);
  //   } else {
  //     console.warn('WebSocket not connected. Cannot emit event:', eventName);
  //   }
  // }
}
