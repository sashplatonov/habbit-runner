package com.sashplatonov.habbit.runner.auth;

import com.sashplatonov.habbit.runner.auth.service.PreferencesService;
import com.sashplatonov.habbit.runner.auth.dto.UpdatePreferencesRequest;
import com.sashplatonov.habbit.runner.auth.dto.UserPreferencesResponse;
import jakarta.ws.rs.BadRequestException;

public class ResourcePreferencesService extends PreferencesService {
  private String lastUserId;
  private UpdatePreferencesRequest lastRequest;
  private UserPreferencesResponse getResponse;
  private UserPreferencesResponse updateResponse;
  private boolean rejectIncompleteCanonicalUpdates;

  public void setGetResponse(UserPreferencesResponse r) { this.getResponse = r; }
  public void setUpdateResponse(UserPreferencesResponse r) { this.updateResponse = r; }
  public void setRejectIncompleteCanonicalUpdates(boolean value) { this.rejectIncompleteCanonicalUpdates = value; }
  public UserPreferencesResponse getGetResponse() { return getResponse; }
  public UserPreferencesResponse getUpdateResponse() { return updateResponse; }
  public String getLastRequestTheme() { return lastRequest == null ? null : lastRequest.theme(); }
  public String getLastUserId() { return lastUserId; }

  @Override
  public UserPreferencesResponse getUserPreferences(String userId) {
    lastUserId = userId;
    return getResponse;
  }

  @Override
  public UserPreferencesResponse updateUserPreferences(String userId, UpdatePreferencesRequest request) {
    lastUserId = userId;
    lastRequest = request;
    if (rejectIncompleteCanonicalUpdates
        && (request.workspace() == null) != (request.revision() == null)) {
      throw new BadRequestException("Canonical workspace revision is required");
    }
    return updateResponse;
  }
}
