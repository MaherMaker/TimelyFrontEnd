import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ToastController } from '@ionic/angular';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { AlarmService } from './alarm.service';
import { AuthService } from './auth.service';
import { AlarmManagerService, AlarmConfig } from './alarm-manager.service';
import { Alarm } from '../models/alarm.model';

describe('AlarmService', () => {
  let service: AlarmService;
  let httpMock: HttpTestingController;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let alarmManagerServiceSpy: jasmine.SpyObj<AlarmManagerService>;
  let toastControllerSpy: jasmine.SpyObj<ToastController>;

  const mockAlarmsInitial: Alarm[] = [
    { id: 1, title: 'Wake Up', time: '07:00', days: [1, 2, 3, 4, 5], isActive: true, deviceId: 'mock-device-1', syncStatus: 'synced', sound: 'default', volume: 80, vibration: true, snoozeInterval: 5, snoozeCount: 3, nativeAlarmId: 'appAlarm-1-dummy' },
    { id: 2, title: 'Meeting', time: '09:00', days: [1], isActive: true, deviceId: 'mock-device-1', syncStatus: 'synced', sound: 'chimes', volume: 70, vibration: true, nativeAlarmId: 'appAlarm-2-dummy' },
  ];

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj('AuthService', ['getAccessToken', 'getCurrentUser'], {
      isAuthenticated$: new BehaviorSubject<boolean>(true), // Default to authenticated
      currentUser$: new BehaviorSubject<any>({ id: 1, username: 'test' }),
      accessToken$: new BehaviorSubject<string | null>('test-token')
    });
    const alarmManagerSpy = jasmine.createSpyObj('AlarmManagerService', ['setNativeAlarm', 'cancelNativeAlarm']);
    const toastSpy = jasmine.createSpyObj('ToastController', ['create']);

    TestBed.configureTestingModule({
      providers: [
        AlarmService,
        { provide: AuthService, useValue: authSpy },
        { provide: AlarmManagerService, useValue: alarmManagerSpy },
        { provide: ToastController, useValue: toastSpy },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(AlarmService);
    httpMock = TestBed.inject(HttpTestingController);
    authServiceSpy = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    alarmManagerServiceSpy = TestBed.inject(AlarmManagerService) as jasmine.SpyObj<AlarmManagerService>;
    toastControllerSpy = TestBed.inject(ToastController) as jasmine.SpyObj<ToastController>;

    // Mock the create method of ToastController to return a promise that resolves to a toast spy object
    const toastSpyInstance = jasmine.createSpyObj('Toast', ['present']);
    toastControllerSpy.create.and.returnValue(Promise.resolve(toastSpyInstance));

    // Mock AlarmManagerService methods
    alarmManagerServiceSpy.setNativeAlarm.and.callFake((config: AlarmConfig): Promise<{ alarmId: string }> => {
      return Promise.resolve({ alarmId: config.alarmId || `native-${Date.now()}` });
    });
    alarmManagerServiceSpy.cancelNativeAlarm.and.returnValue(Promise.resolve());

    // Initialize service with mock alarms for consistent testing of mock-based functions
    (service as any).mockAlarms = JSON.parse(JSON.stringify(mockAlarmsInitial)); // Deep copy
    (service as any).alarmsSubject.next((service as any).parseAlarmsDays(JSON.parse(JSON.stringify(mockAlarmsInitial))));

    spyOn(console, 'log').and.callThrough();
    spyOn(console, 'warn').and.callThrough();
    spyOn(console, 'error').and.callThrough();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Auth State Changes', () => {
    it('should clear alarms when user is not authenticated', () => {
      (authServiceSpy.isAuthenticated$ as BehaviorSubject<boolean>).next(false);
      service.alarms$.subscribe(alarms => {
        expect(alarms.length).toBe(0);
      });
    });

    it('should load alarms when user becomes authenticated', () => {
      spyOn(service, 'loadAlarms').and.callThrough();
      (authServiceSpy.isAuthenticated$ as BehaviorSubject<boolean>).next(false); // Start as unauth
      (authServiceSpy.isAuthenticated$ as BehaviorSubject<boolean>).next(true); // Transition to auth
      expect(service.loadAlarms).toHaveBeenCalled();
    });
  });

  describe('loadAlarms (Mock Implementation)', () => {
    it('should load mock alarms into the alarmsSubject', fakeAsync(() => {
      (service as any).mockAlarms = [{ id: 100, title: 'Test Load', time: '10:00', days: [], isActive: true, deviceId: 'test', syncStatus: 'synced' }];
      service.loadAlarms().subscribe();
      tick();
      service.alarms$.subscribe(alarms => {
        expect(alarms.length).toBe(1);
        expect(alarms[0].title).toBe('Test Load');
      });
      tick();
    }));
  });

  describe('getAlarm (Mock Implementation)', () => {
    it('should return a specific alarm by ID from mock data', fakeAsync(() => {
      let foundAlarm: Alarm | undefined;
      service.getAlarm(1).subscribe(alarm => foundAlarm = alarm);
      tick();
      expect(foundAlarm).toBeTruthy();
      expect(foundAlarm?.id).toBe(1);
      expect(foundAlarm?.title).toBe('Wake Up');
    }));

    it('should return an error if alarm ID is not found in mock data', fakeAsync(() => {
      let error: any;
      service.getAlarm(999).subscribe({
        error: e => error = e
      });
      tick();
      expect(error).toBeTruthy();
      expect(error.message).toContain('Mock alarm not found');
    }));
  });

  describe('createAlarm (Mock Implementation)', () => {
    const newAlarmData: Omit<Alarm, 'id' | 'syncStatus' | 'deviceId'> = {
      title: 'New Test Alarm',
      time: '10:30',
      days: [0, 6], // Sunday, Saturday
      isActive: true,
      sound: 'radar',
      volume: 90,
      vibration: true,
      snoozeInterval: 10,
      snoozeCount: 2,
      noRepeat: false,
    };

    beforeEach(() => {
      // Reset mockAlarms to a known state before each create test
      (service as any).mockAlarms = JSON.parse(JSON.stringify(mockAlarmsInitial));
      (service as any).alarmsSubject.next((service as any).parseAlarmsDays(JSON.parse(JSON.stringify(mockAlarmsInitial))));
      localStorage.setItem('device_id', 'test-device-ls');
    });

    afterEach(() => {
      localStorage.removeItem('device_id');
    });

    it('should create an alarm, add to mockAlarms, update subject, and schedule native alarm if active', fakeAsync(() => {
      let createdAlarm: Alarm | undefined;
      const expectedNativeIdPrefix = 'appAlarm-3'; // Assuming next ID is 3
      alarmManagerServiceSpy.setNativeAlarm.and.callFake((config: AlarmConfig) => 
        Promise.resolve({ alarmId: `${expectedNativeIdPrefix}-${config.at}`})
      );

      service.createAlarm(newAlarmData).subscribe(alarm => createdAlarm = alarm);
      tick(); // For async operations in createAlarm (scheduleNativeAndFinalizeAlarm, tap, etc.)

      expect(createdAlarm).toBeTruthy();
      expect(createdAlarm?.title).toBe(newAlarmData.title);
      expect(createdAlarm?.isActive).toBe(true);
      expect(createdAlarm?.syncStatus).toBe('synced'); // Assuming native schedule succeeds
      expect(createdAlarm?.deviceId).toBe('test-device-ls');
      expect(createdAlarm?.id).toBe(3); // mockAlarmsInitial has 2 alarms

      // Check native alarm scheduling
      expect(alarmManagerServiceSpy.setNativeAlarm).toHaveBeenCalled();
      const setNativeAlarmArgs = alarmManagerServiceSpy.setNativeAlarm.calls.mostRecent().args[0];
      expect(setNativeAlarmArgs.alarmId).toContain(expectedNativeIdPrefix);
      expect(setNativeAlarmArgs.name).toBe(newAlarmData.title);
      expect(setNativeAlarmArgs.exact).toBe(true);
      expect(createdAlarm?.nativeAlarmId).toContain(expectedNativeIdPrefix);

      // Check alarms subject
      const currentAlarms = (service as any).alarmsSubject.getValue();
      expect(currentAlarms.length).toBe(mockAlarmsInitial.length + 1);
      const createdAlarmInSubject = currentAlarms.find((a: Alarm) => a.id === createdAlarm?.id);
      expect(createdAlarmInSubject).toEqual(createdAlarm);

      // Check toast
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${newAlarmData.title}" created.`,
        color: 'success'
      }));
    }));

    it('should create an alarm but not schedule native if isActive is false', fakeAsync(() => {
      const inactiveAlarmData = { ...newAlarmData, isActive: false };
      let createdAlarm: Alarm | undefined;

      service.createAlarm(inactiveAlarmData).subscribe(alarm => createdAlarm = alarm);
      tick();

      expect(createdAlarm).toBeTruthy();
      expect(createdAlarm?.isActive).toBe(false);
      expect(createdAlarm?.nativeAlarmId).toBeUndefined();
      expect(alarmManagerServiceSpy.setNativeAlarm).not.toHaveBeenCalled();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${inactiveAlarmData.title}" created.`,
        color: 'success'
      }));
    }));

    it('should set syncStatus to conflict and show error toast if native alarm scheduling fails', fakeAsync(() => {
      alarmManagerServiceSpy.setNativeAlarm.and.returnValue(Promise.reject('Native scheduling failed'));
      let createdAlarm: Alarm | undefined;

      service.createAlarm(newAlarmData).subscribe(alarm => createdAlarm = alarm);
      tick();

      expect(createdAlarm).toBeTruthy();
      expect(createdAlarm?.syncStatus).toBe('conflict');
      expect(createdAlarm?.nativeAlarmId).toBeUndefined();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Native alarm for "${newAlarmData.title}" failed to schedule.`,
        color: 'danger'
      }));
      // The success toast for creation should not be called in this case
      expect(toastControllerSpy.create).not.toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${newAlarmData.title}" created.`,
        color: 'success'
      })); 
    }));

    it('should set syncStatus to conflict if calculateNextAlarmTimestamp returns null', fakeAsync(() => {
      spyOn((service as any), 'calculateNextAlarmTimestamp').and.returnValue(null);
      let createdAlarm: Alarm | undefined;

      service.createAlarm(newAlarmData).subscribe(alarm => createdAlarm = alarm);
      tick();

      expect(createdAlarm).toBeTruthy();
      expect(createdAlarm?.syncStatus).toBe('conflict');
      expect(alarmManagerServiceSpy.setNativeAlarm).not.toHaveBeenCalled();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Could not calculate time for "${newAlarmData.title}".`,
        color: 'danger'
      }));
    }));

    it('should use default values for optional fields if not provided', fakeAsync(() => {
      const minimalAlarmData: Omit<Alarm, 'id' | 'syncStatus' | 'deviceId' | 'time' | 'title' | 'days'> = {};
      const fullMinimalData = { title: 'MinTest', time: '00:00', days: [], ...minimalAlarmData };
      let createdAlarm: Alarm | undefined;

      service.createAlarm(fullMinimalData).subscribe(alarm => createdAlarm = alarm);
      tick();

      expect(createdAlarm).toBeTruthy();
      expect(createdAlarm?.isActive).toBe(true); // Default
      expect(createdAlarm?.sound).toBe('default'); // Default
      expect(createdAlarm?.volume).toBe(80); // Default
      expect(createdAlarm?.vibration).toBe(true); // Default
      expect(createdAlarm?.snoozeInterval).toBe(5); // Default
      expect(createdAlarm?.snoozeCount).toBe(3); // Default
      expect(createdAlarm?.noRepeat).toBe(false); // Default
    }));

    it('should handle error during the createAlarm observable chain and show error toast', fakeAsync(() => {
      // Make a downstream operation fail, e.g., the tap operator after scheduleNativeAndFinalizeAlarm
      spyOn((service as any).alarmsSubject, 'next').and.throwError('Subject.next failed');
      let errorThrown: any;

      service.createAlarm(newAlarmData).subscribe({
        next: () => fail('Should not succeed'),
        error: (err) => errorThrown = err
      });
      tick();

      expect(errorThrown).toBeTruthy();
      expect(errorThrown.message).toContain('Failed to create alarm');
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: 'Failed to finalize alarm creation.',
        color: 'danger'
      }));
    })); 

  });

  describe('updateAlarm (Mock Implementation)', () => {
    const alarmToUpdateId = 1;
    const originalAlarm = mockAlarmsInitial.find((a: Alarm) => a.id === alarmToUpdateId)!;

    beforeEach(() => {
      // Reset mockAlarms and subject to a known state before each update test
      (service as any).mockAlarms = JSON.parse(JSON.stringify(mockAlarmsInitial));
      (service as any).alarmsSubject.next((service as any).parseAlarmsDays(JSON.parse(JSON.stringify(mockAlarmsInitial))));
      alarmManagerServiceSpy.setNativeAlarm.calls.reset();
      alarmManagerServiceSpy.cancelNativeAlarm.calls.reset();
      toastControllerSpy.create.calls.reset();
       // Reset toast create spy to return a new fresh promise each time
      const toastSpyInstance = jasmine.createSpyObj('Toast', ['present']);
      toastControllerSpy.create.and.returnValue(Promise.resolve(toastSpyInstance));
    });

    it('should update an alarm, reschedule native alarm if active, and show success toast', fakeAsync(() => {
      const updates: Partial<Alarm> = { title: 'Updated Wake Up', time: '07:15' };
      let updatedAlarm: Alarm | undefined;
      const expectedNewNativeIdPrefix = `appAlarm-${alarmToUpdateId}`;

      alarmManagerServiceSpy.setNativeAlarm.and.callFake((config: AlarmConfig) => 
        Promise.resolve({ alarmId: `${expectedNewNativeIdPrefix}-newTime-${config.at}`})
      );

      service.updateAlarm(alarmToUpdateId, updates).subscribe(alarm => updatedAlarm = alarm);
      tick(); // For async operations in updateAlarm

      expect(updatedAlarm).toBeTruthy();
      expect(updatedAlarm?.id).toBe(alarmToUpdateId);
      expect(updatedAlarm?.title).toBe(updates.title);
      expect(updatedAlarm?.time).toBe(updates.time);
      expect(updatedAlarm?.syncStatus).toBe('synced');

      // Check native alarm rescheduling
      expect(alarmManagerServiceSpy.cancelNativeAlarm).toHaveBeenCalledWith({ alarmId: originalAlarm.nativeAlarmId! });
      expect(alarmManagerServiceSpy.setNativeAlarm).toHaveBeenCalled();
      const setNativeArgs = alarmManagerServiceSpy.setNativeAlarm.calls.mostRecent().args[0];
      expect(setNativeArgs.alarmId).toContain(expectedNewNativeIdPrefix);
      expect(setNativeArgs.name).toBe(updates.title);
      expect(updatedAlarm?.nativeAlarmId).toContain(expectedNewNativeIdPrefix);

      // Check subject
      const currentAlarms = (service as any).alarmsSubject.getValue();
      const alarmInSubject = currentAlarms.find((a: Alarm) => a.id === alarmToUpdateId);
      expect(alarmInSubject?.title).toBe(updates.title);

      // Check toast
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${updates.title}" updated.`,
        color: 'success'
      }));
    }));

    it('should update alarm, cancel old native alarm, and NOT schedule new if becoming inactive', fakeAsync(() => {
      const updates: Partial<Alarm> = { isActive: false, title: 'Sleeping In' };
      let updatedAlarm: Alarm | undefined;

      service.updateAlarm(alarmToUpdateId, updates).subscribe(alarm => updatedAlarm = alarm);
      tick();

      expect(updatedAlarm).toBeTruthy();
      expect(updatedAlarm?.isActive).toBe(false);
      expect(updatedAlarm?.title).toBe(updates.title);
      expect(updatedAlarm?.nativeAlarmId).toBeUndefined();
      expect(updatedAlarm?.syncStatus).toBe('synced'); // Sync status for inactive is still 'synced' if processed correctly

      expect(alarmManagerServiceSpy.cancelNativeAlarm).toHaveBeenCalledWith({ alarmId: originalAlarm.nativeAlarmId! });
      expect(alarmManagerServiceSpy.setNativeAlarm).not.toHaveBeenCalled();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${updates.title}" updated.`,
        color: 'success'
      }));
    }));

    it('should update alarm, schedule new native alarm if becoming active (no old nativeId)', fakeAsync(() => {
      // First, make the alarm inactive and remove its nativeAlarmId to simulate that state
      const initialAlarm = (service as any).mockAlarms.find((a: Alarm) => a.id === alarmToUpdateId);
      initialAlarm.isActive = false;
      initialAlarm.nativeAlarmId = undefined;
      (service as any).alarmsSubject.next((service as any).parseAlarmsDays([...(service as any).mockAlarms]));
      
      const updates: Partial<Alarm> = { isActive: true, time: '08:00' };
      let updatedAlarm: Alarm | undefined;

      service.updateAlarm(alarmToUpdateId, updates).subscribe(alarm => updatedAlarm = alarm);
      tick();

      expect(updatedAlarm).toBeTruthy();
      expect(updatedAlarm?.isActive).toBe(true);
      expect(updatedAlarm?.nativeAlarmId).toBeDefined();
      expect(updatedAlarm?.syncStatus).toBe('synced');

      expect(alarmManagerServiceSpy.cancelNativeAlarm).not.toHaveBeenCalled(); // No old native ID to cancel
      expect(alarmManagerServiceSpy.setNativeAlarm).toHaveBeenCalled();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${updatedAlarm?.title}" updated.`,
        color: 'success'
      }));
    }));

    it('should set syncStatus to conflict if rescheduling native alarm fails', fakeAsync(() => {
      alarmManagerServiceSpy.setNativeAlarm.and.returnValue(Promise.reject('New native schedule failed'));
      const updates: Partial<Alarm> = { time: '07:30' };
      let updatedAlarm: Alarm | undefined;

      service.updateAlarm(alarmToUpdateId, updates).subscribe(alarm => updatedAlarm = alarm);
      tick();

      expect(updatedAlarm).toBeTruthy();
      expect(updatedAlarm?.syncStatus).toBe('conflict');
      expect(alarmManagerServiceSpy.cancelNativeAlarm).toHaveBeenCalledWith({ alarmId: originalAlarm.nativeAlarmId! });
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Native alarm for "${originalAlarm.title}" failed to schedule.`,
        color: 'danger'
      }));
      expect(toastControllerSpy.create).not.toHaveBeenCalledWith(jasmine.objectContaining({ color: 'success' }));
    }));

    it('should show error and not change original if cancelling old native alarm fails, but still try to set new one (and likely fail status)', fakeAsync(() => {
      alarmManagerServiceSpy.cancelNativeAlarm.and.returnValue(Promise.reject('Cancel failed'));
      // To make it more realistic, if cancel fails, the new set might also be problematic or lead to conflict
      alarmManagerServiceSpy.setNativeAlarm.and.returnValue(Promise.reject('Set also failed due to prior error')); 
      const updates: Partial<Alarm> = { time: '07:45' };
      let resultAlarm: Alarm | undefined;

      service.updateAlarm(alarmToUpdateId, updates).subscribe(alarm => resultAlarm = alarm);
      tick();

      expect(resultAlarm).toBeTruthy();
      expect(resultAlarm?.syncStatus).toBe('conflict'); // Should be conflict due to setNativeAlarm failing
      
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Could not cancel old native alarm for "${originalAlarm.title}". Update may be incomplete.`,
        color: 'danger'
      }));
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Native alarm for "${originalAlarm.title}" failed to schedule.`,
        color: 'danger'
      }));
      
      const alarmInSubject = (service as any).alarmsSubject.getValue().find((a: Alarm) => a.id === alarmToUpdateId);
      expect(alarmInSubject?.time).toBe(updates.time); // Optimistic UI update might happen for data
      expect(alarmInSubject?.syncStatus).toBe('conflict');
    }));

    it('should return error if alarm to update is not found', fakeAsync(() => {
      let error: any;
      service.updateAlarm(999, { title: 'Ghost Alarm' }).subscribe({
        error: e => error = e
      });
      tick();
      expect(error).toBeTruthy();
      expect(error.message).toContain('Mock alarm not found for update');
      expect(alarmManagerServiceSpy.cancelNativeAlarm).not.toHaveBeenCalled();
      expect(alarmManagerServiceSpy.setNativeAlarm).not.toHaveBeenCalled();
    }));

    it('should handle error in updateAlarm observable chain and show error toast', fakeAsync(() => {
        alarmManagerServiceSpy.setNativeAlarm.and.callFake(() => Promise.resolve({ alarmId: 'any-id'})); // Ensure this part passes
        spyOn((service as any).alarmsSubject, 'next').and.throwError('Subject.next failed during update');
        let errorThrown: any;
        const updates: Partial<Alarm> = { title: 'Update Fail Test' };

        service.updateAlarm(alarmToUpdateId, updates).subscribe({
            next: () => fail('Should not succeed'),
            error: (err) => errorThrown = err
        });
        tick();

        expect(errorThrown).toBeTruthy();
        expect(errorThrown.message).toContain('Failed to update alarm');
        expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
            message: 'Failed to finalize alarm update.',
            color: 'danger'
        }));
        // Check that the subject was attempted to be updated, then failed, and the alarm in mockAlarms reflects the conflict
        const alarmInMock = (service as any).mockAlarms.find((a: Alarm) => a.id === alarmToUpdateId);
        expect(alarmInMock?.title).toBe(updates.title); // Data changed before error in tap
        expect(alarmInMock?.syncStatus).toBe('conflict'); // Set to conflict in catchError
    }));

  });

  describe('deleteAlarm (Mock Implementation)', () => {
    const alarmToDeleteId = 1;
    const alarmToDelete = mockAlarmsInitial.find((a: Alarm) => a.id === alarmToDeleteId)!;

    beforeEach(() => {
      (service as any).mockAlarms = JSON.parse(JSON.stringify(mockAlarmsInitial));
      (service as any).alarmsSubject.next((service as any).parseAlarmsDays(JSON.parse(JSON.stringify(mockAlarmsInitial))));
      alarmManagerServiceSpy.cancelNativeAlarm.calls.reset();
      toastControllerSpy.create.calls.reset();
      const toastSpyInstance = jasmine.createSpyObj('Toast', ['present']);
      toastControllerSpy.create.and.returnValue(Promise.resolve(toastSpyInstance));
    });

    it('should delete an alarm, cancel its native alarm, update subject, and show success toast', fakeAsync(() => {
      let deleteResult: void | undefined;
      let errorResult: any;

      service.deleteAlarm(alarmToDeleteId).subscribe({
        next: (v) => deleteResult = v,
        error: (e) => errorResult = e
      });
      tick(); // For async operations in deleteAlarm

      expect(errorResult).toBeUndefined();
      expect((service as any).mockAlarms.find((a: Alarm) => a.id === alarmToDeleteId)).toBeUndefined();
      expect((service as any).alarmsSubject.getValue().find((a: Alarm) => a.id === alarmToDeleteId)).toBeUndefined();
      expect(alarmManagerServiceSpy.cancelNativeAlarm).toHaveBeenCalledWith({ alarmId: alarmToDelete.nativeAlarmId! });
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${alarmToDelete.title}" deleted.`,
        color: 'success'
      }));
    }));

    it('should delete an alarm without calling cancelNativeAlarm if no nativeAlarmId exists', fakeAsync(() => {
      const alarmWithoutNativeId = {
        id: 3, title: 'No Native', time: '12:00', days: [], isActive: true, deviceId: 'test-dev', syncStatus: 'synced'
      };
      (service as any).mockAlarms.push(alarmWithoutNativeId);
      (service as any).alarmsSubject.next((service as any).parseAlarmsDays([...(service as any).mockAlarms]));

      service.deleteAlarm(alarmWithoutNativeId.id).subscribe();
      tick();

      expect((service as any).mockAlarms.find((a: Alarm) => a.id === alarmWithoutNativeId.id)).toBeUndefined();
      expect(alarmManagerServiceSpy.cancelNativeAlarm).not.toHaveBeenCalled();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${alarmWithoutNativeId.title}" deleted.`,
        color: 'success'
      }));
    }));

    it('should still delete alarm from list and show success toast, but also error toast if native alarm cancellation fails', fakeAsync(() => {
      alarmManagerServiceSpy.cancelNativeAlarm.and.returnValue(Promise.reject('Native cancel failed'));

      service.deleteAlarm(alarmToDeleteId).subscribe();
      tick();

      expect((service as any).mockAlarms.find((a: Alarm) => a.id === alarmToDeleteId)).toBeUndefined();
      expect(alarmManagerServiceSpy.cancelNativeAlarm).toHaveBeenCalledWith({ alarmId: alarmToDelete.nativeAlarmId! });
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Failed to cancel native alarm for "${alarmToDelete.title}". It might still be active.`,
        color: 'danger'
      }));
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${alarmToDelete.title}" deleted.`,
        color: 'success' // The delete success toast is still shown as per current implementation
      }));
    }));

    it('should return error if alarm to delete is not found', fakeAsync(() => {
      let error: any;
      service.deleteAlarm(999).subscribe({
        error: e => error = e
      });
      tick();

      expect(error).toBeTruthy();
      expect(error.message).toContain('Mock alarm not found for delete');
      expect((service as any).mockAlarms.length).toBe(mockAlarmsInitial.length);
      expect(alarmManagerServiceSpy.cancelNativeAlarm).not.toHaveBeenCalled();
      expect(toastControllerSpy.create).not.toHaveBeenCalledWith(jasmine.objectContaining({ color: 'success' }));
    }));

    it('should handle error in deleteAlarm observable chain (after native ops) and show general error toast', fakeAsync(() => {
      // Simulate error after native cancellation but before subject update or final success toast
      alarmManagerServiceSpy.cancelNativeAlarm.and.returnValue(Promise.resolve()); // Native op succeeds
      spyOn((service as any).alarmsSubject, 'next').and.throwError('Subject.next failed during delete');
      let errorThrown: any;

      service.deleteAlarm(alarmToDeleteId).subscribe({
        next: () => fail('Should not succeed to this point'),
        error: (err) => errorThrown = err
      });
      tick();

      expect(errorThrown).toBeTruthy();
      expect(errorThrown.message).toContain('Failed to delete alarm');
      // mockAlarms would have been filtered before the .next() call in the implementation, so it should be removed
      expect((service as any).mockAlarms.find((a: Alarm) => a.id === alarmToDeleteId)).toBeUndefined();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: 'Failed to fully delete alarm.',
        color: 'danger'
      }));
      // The specific success toast for deletion should not be called if the chain errors out before it
      expect(toastControllerSpy.create).not.toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${alarmToDelete.title}" deleted.`,
        color: 'success'
      }));
    }));

  });

  describe('toggleAlarmActive (Mock Implementation)', () => {
    const alarmToToggleId = 1;
    const originalAlarm = mockAlarmsInitial.find((a: Alarm) => a.id === alarmToToggleId)!;

    beforeEach(() => {
      (service as any).mockAlarms = JSON.parse(JSON.stringify(mockAlarmsInitial));
      (service as any).alarmsSubject.next((service as any).parseAlarmsDays(JSON.parse(JSON.stringify(mockAlarmsInitial))));
      alarmManagerServiceSpy.setNativeAlarm.calls.reset();
      alarmManagerServiceSpy.cancelNativeAlarm.calls.reset();
      toastControllerSpy.create.calls.reset();
      const toastSpyInstance = jasmine.createSpyObj('Toast', ['present']);
      toastControllerSpy.create.and.returnValue(Promise.resolve(toastSpyInstance));
    });

    it('should toggle alarm from active to inactive, cancel native alarm, and show update toast', fakeAsync(() => {
      expect(originalAlarm.isActive).toBe(true);
      let toggledAlarm: Alarm | undefined;

      service.toggleAlarmActive(alarmToToggleId).subscribe(alarm => toggledAlarm = alarm);
      tick();

      expect(toggledAlarm).toBeTruthy();
      expect(toggledAlarm?.id).toBe(alarmToToggleId);
      expect(toggledAlarm?.isActive).toBe(false);
      expect(toggledAlarm?.nativeAlarmId).toBeUndefined(); // Should be removed when inactive
      expect(toggledAlarm?.syncStatus).toBe('synced'); // Update to inactive is a synced action

      expect(alarmManagerServiceSpy.cancelNativeAlarm).toHaveBeenCalledWith({ alarmId: originalAlarm.nativeAlarmId! });
      expect(alarmManagerServiceSpy.setNativeAlarm).not.toHaveBeenCalled();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${originalAlarm.title}" updated.`,
        color: 'success'
      }));
    }));

    it('should toggle alarm from inactive to active, schedule native alarm, and show update toast', fakeAsync(() => {
      // First, set the alarm to inactive and remove nativeAlarmId for a clean test state
      const initialAlarm = (service as any).mockAlarms.find((a: Alarm) => a.id === alarmToToggleId);
      initialAlarm.isActive = false;
      initialAlarm.nativeAlarmId = undefined;
      (service as any).alarmsSubject.next((service as any).parseAlarmsDays([...(service as any).mockAlarms]));
      alarmManagerServiceSpy.cancelNativeAlarm.calls.reset(); // Reset from the setup modification
      const expectedNewNativeIdPrefix = `appAlarm-${alarmToToggleId}`;
      alarmManagerServiceSpy.setNativeAlarm.and.callFake((config: AlarmConfig) => 
        Promise.resolve({ alarmId: `${expectedNewNativeIdPrefix}-toggled-${config.at}`})
      );

      let toggledAlarm: Alarm | undefined;
      service.toggleAlarmActive(alarmToToggleId).subscribe(alarm => toggledAlarm = alarm);
      tick();

      expect(toggledAlarm).toBeTruthy();
      expect(toggledAlarm?.isActive).toBe(true);
      expect(toggledAlarm?.nativeAlarmId).toContain(expectedNewNativeIdPrefix);
      expect(toggledAlarm?.syncStatus).toBe('synced');

      expect(alarmManagerServiceSpy.cancelNativeAlarm).not.toHaveBeenCalled(); // No old native ID to cancel
      expect(alarmManagerServiceSpy.setNativeAlarm).toHaveBeenCalled();
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Alarm "${initialAlarm.title}" updated.`,
        color: 'success'
      }));
    }));

    it('should return error if alarm to toggle is not found', fakeAsync(() => {
      let error: any;
      service.toggleAlarmActive(999).subscribe({
        error: e => error = e
      });
      tick();

      expect(error).toBeTruthy();
      expect(error.message).toContain('Mock alarm with id 999 not found for toggle');
      expect(alarmManagerServiceSpy.cancelNativeAlarm).not.toHaveBeenCalled();
      expect(alarmManagerServiceSpy.setNativeAlarm).not.toHaveBeenCalled();
    }));

    it('should propagate error from updateAlarm if native scheduling fails during toggle to active', fakeAsync(() => {
      const initialAlarm = (service as any).mockAlarms.find((a: Alarm) => a.id === alarmToToggleId);
      initialAlarm.isActive = false;
      initialAlarm.nativeAlarmId = undefined;
      (service as any).alarmsSubject.next((service as any).parseAlarmsDays([...(service as any).mockAlarms]));
      alarmManagerServiceSpy.cancelNativeAlarm.calls.reset();

      alarmManagerServiceSpy.setNativeAlarm.and.returnValue(Promise.reject('Native schedule failed during toggle'));
      let error: any;

      service.toggleAlarmActive(alarmToToggleId).subscribe({
        next: alarm => {
          // The alarm object itself might be returned by updateAlarm before the error is caught by the final subscriber
          // but its syncStatus should reflect the issue.
          expect(alarm.syncStatus).toBe('conflict');
        },
        error: e => error = e
      });
      tick(); // Process promises from toggleAlarmActive/updateAlarm/setNativeAlarm
      tick(); // Additional tick for potentially lingering async operations in showErrorToast
      
      expect(error).toBeTruthy(); // Error from toggleAlarmActive's observable chain

      const alarmInSubject = (service as any).alarmsSubject.getValue().find((a: Alarm) => a.id === alarmToToggleId);
      expect(alarmInSubject?.isActive).toBe(true); // Optimistic update of isActive might occur
      expect(alarmInSubject?.syncStatus).toBe('conflict');
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: 'Failed to finalize alarm update.', // Error from updateAlarm's catchError
        color: 'danger'
      }));
      expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
        message: `Native alarm for "${initialAlarm.title}" failed to schedule.`,
        color: 'danger' // Specific error from scheduleNativeAndFinalizeAlarm
      }));
    }));
  });

  describe('syncAlarmsWithBackend (Mock Implementation)', () => {
    it('should indicate sync is not applicable for mock service or is successful if called', (done) => {
      // Option 1: If sync is a no-op for mock and returns void or true
      // service.syncAlarmsWithBackend().subscribe({ // Assuming it might return an observable
      //   complete: () => {
      //     expect(true).toBe(true); // Placeholder for successful completion
      //     done();
      //   }
      // });
      // Option 2: If it directly returns a promise
      // service.syncAlarmsWithBackend().then(() => {
      //   expect(true).toBe(true);
      //   done();
      // });

      // Option 3: If it's truly a no-op or not implemented for mock,
      // we can just acknowledge that or spy and expect it not to throw.
      const syncSpy = spyOn(service as any, 'syncAlarmsWithBackend').and.callThrough(); // Cast service to any
      try {
        const result = (service as any).syncAlarmsWithBackend(); // Cast service to any
        // If it returns an observable, subscribe to complete it.
        if (result && typeof (result as any).subscribe === 'function') {
          (result as any).subscribe({
            next: () => {}, // eslint-disable-line @typescript-eslint/no-empty-function
            complete: () => done(),
            error: (err: any) => done.fail(err)
          });
        } else if (result && typeof (result as any).then === 'function') {
          (result as any).then(() => done(), (err: any) => done.fail(err));
        }
        else {
          done(); // If it's synchronous and doesn't return Observable/Promise
        }
      } catch (error: any) {
        done.fail(error);
      }
      expect(syncSpy).toHaveBeenCalled();
      // Depending on actual mock implementation, more specific expects can be added.
      // For example, if it's supposed to show a toast:
      // expect(toastControllerSpy.create).toHaveBeenCalledWith(jasmine.objectContaining({
      //   message: 'Sync with backend is not applicable for mock service.',
      //   duration: 2000
      // }));
    });
  });

});
