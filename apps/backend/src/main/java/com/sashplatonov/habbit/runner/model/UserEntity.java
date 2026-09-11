package com.sashplatonov.habbit.runner.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "users")
@Getter
@Setter
public class UserEntity extends UuidAuditedEntityBase {
  @Column(unique = true)
  private String email;

  @Column(nullable = false)
  private String theme;

  @Column
  private String timezone;

  @Column(name = "dashboardPreferences", nullable = false)
  private String dashboardPreferences = "{}";

  @Column(name = "workspacePreferences", nullable = false)
  private String workspacePreferences = "{}";

  @Column(name = "workspacePreferencesRevision", nullable = false)
  private Long workspacePreferencesRevision = 0L;

  @PrePersist
  void prePersist() {
    if (getTheme() == null || getTheme().isBlank()) {
      setTheme("cloud");
    }
    if (getWorkspacePreferences() == null) {
      setWorkspacePreferences("{}");
    }
    if (getWorkspacePreferencesRevision() == null) {
      setWorkspacePreferencesRevision(0L);
    }
  }

  public void markCreatedAt(Instant instant) {
    setCreatedAt(instant);
  }
}
