package com.sashplatonov.habbit.runner.auth.service;

import com.sashplatonov.habbit.runner.auth.dto.UserPreferencesResponse;

public class WorkspacePreferencesConflictException extends RuntimeException {
  private final UserPreferencesResponse current;

  public WorkspacePreferencesConflictException(UserPreferencesResponse current) {
    super("Workspace preferences were changed by another device");
    this.current = current;
  }

  public UserPreferencesResponse current() {
    return current;
  }
}
