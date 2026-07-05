import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { TasksApiService } from '../../services/tasks-api.service';

interface TaskCreateForm {
  task_type: string;
  title: string;
  description: string;
  client_name: string;
  client_phone: string;
  client_channel: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

@Component({
  selector: 'app-task-create',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatDividerModule,
  ],
  templateUrl: './task-create.component.html',
  styleUrl: './task-create.component.scss',
})
export class TaskCreateComponent {
  private readonly tasksApi = inject(TasksApiService);
  private readonly router = inject(Router);

  isSubmitting = signal(false);

  form: TaskCreateForm = {
    task_type: 'walk_in',
    title: '',
    description: '',
    client_name: '',
    client_phone: '',
    client_channel: 'walk_in',
    priority: 'normal',
  };

  create() {
    if (!this.form.task_type || !this.form.title) return;
    this.isSubmitting.set(true);

    this.tasksApi.createTask(this.form).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        if (res.success && res.data) {
          this.router.navigate(['/employee/tasks', res.data.id]);
        }
      },
      error: () => this.isSubmitting.set(false),
    });
  }
}
