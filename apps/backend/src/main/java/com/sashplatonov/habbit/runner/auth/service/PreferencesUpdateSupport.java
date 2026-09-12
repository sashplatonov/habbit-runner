package com.sashplatonov.habbit.runner.auth.service;

import com.sashplatonov.habbit.runner.auth.dto.UpdatePreferencesRequest;
import com.sashplatonov.habbit.runner.auth.dto.UserWorkspacePreferences;
import com.sashplatonov.habbit.runner.auth.support.ThemeCatalog;
import com.sashplatonov.habbit.runner.model.UserEntity;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotAuthorizedException;

final class PreferencesUpdateSupport {
  private PreferencesUpdateSupport() {
  }

  static void requireCanonicalWorkspaceAndRevisionTogether(UpdatePreferencesRequest request) {
    if ((request.workspace() != null) != (request.revision() != null)) {
      throw new BadRequestException("Canonical workspace revision is required");
    }
  }

  static void requireExistingUser(UserEntity user) {
    if (user == null) {
      throw new NotAuthorizedException("User no longer exists");
    }
  }

  static void requireValidRevision(Long revision) {
    if (revision == null || revision < 0) {
      throw new BadRequestException("Canonical workspace revision is required");
    }
  }

  static void persistWorkspace(UserEntity user, UserWorkspacePreferences workspace,
                               WorkspacePreferencesCodec codec) {
    user.setWorkspacePreferences(codec.write(workspace));
    user.setWorkspacePreferencesRevision(nextRevision(user));
  }

  static void updateOptionalProfilePreferences(UserEntity user, UpdatePreferencesRequest request) {
    if (request.theme() != null) {
      user.setTheme(ThemeCatalog.normalize(request.theme()));
    }
    updateTimezoneIfPresent(user, request.timezone());
  }

  static void updateTimezoneIfPresent(UserEntity user, String timezone) {
    if (timezone != null) {
      user.setTimezone(timezone.isBlank() ? null : timezone);
    }
  }

  private static long nextRevision(UserEntity user) {
    return (user.getWorkspacePreferencesRevision() == null ? 0L : user.getWorkspacePreferencesRevision()) + 1L;
  }
}
