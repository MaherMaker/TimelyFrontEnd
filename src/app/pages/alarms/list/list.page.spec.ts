import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { ListPage } from './list.page';
import { IonicModule } from '@ionic/angular';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AlarmService } from '../../../services/alarm.service'; // Import AlarmService
import { AuthService } from '../../../services/auth.service'; // Import AuthService
import { of, BehaviorSubject } from 'rxjs'; // Import of and BehaviorSubject for mocking

describe('ListPage', () => {
  let component: ListPage;
  let fixture: ComponentFixture<ListPage>;
  let alarmServiceSpy: jasmine.SpyObj<AlarmService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  beforeEach(waitForAsync(() => {
    const alarmSpy = jasmine.createSpyObj('AlarmService', ['loadAlarms', 'getAlarms', 'deleteAlarm', 'toggleAlarmActive'], {
      alarms$: of([]) // Mock alarms$ observable
    });
    const authSpy = jasmine.createSpyObj('AuthService', ['getCurrentUser'], {
      isAuthenticated$: new BehaviorSubject<boolean>(true), // Mock isAuthenticated$
      currentUser$: new BehaviorSubject<any>(null) // Mock currentUser$
    });

    TestBed.configureTestingModule({
      // declarations: [ ListPage ], // Removed for standalone
      imports: [ ListPage, IonicModule.forRoot() ], // Import ListPage as it's standalone
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AlarmService, useValue: alarmSpy },
        { provide: AuthService, useValue: authSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ListPage);
    component = fixture.componentInstance;
    alarmServiceSpy = TestBed.inject(AlarmService) as jasmine.SpyObj<AlarmService>;
    authServiceSpy = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
