package com.sashplatonov.habbit.runner.auth.resource;

import com.sashplatonov.habbit.runner.auth.ResourcePreferencesService;
import com.sashplatonov.habbit.runner.auth.dto.UserPreferencesResponse;
import com.sashplatonov.habbit.runner.auth.security.CurrentUser;
import com.sashplatonov.habbit.runner.auth.security.CurrentUserContext;
import com.sashplatonov.habbit.runner.auth.dto.UpdatePreferencesRequest;
import com.sashplatonov.habbit.runner.support.TestHelpers;
import jakarta.ws.rs.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AuthPreferencesResourceUnitTest {

  @Test
  void shouldDelegatePreferenceEndpointsToPreferencesServiceForCurrentUser() {
    var preferencesService = new ResourcePreferencesService();
    preferencesService.setGetResponse(new UserPreferencesResponse("cloud", "Europe/Berlin"));
    preferencesService.setUpdateResponse(new UserPreferencesResponse("matrix", null));
    var currentUserContext = new CurrentUserContext();
    currentUserContext.setUser(new CurrentUser("user-1", "user@example.test"));
    var resource = new AuthPreferencesResource(preferencesService, currentUserContext);

    var current = resource.getPreferences();
    var updated = resource.updatePreferences(new UpdatePreferencesRequest("matrix", null));

    assertEquals("user-1", preferencesService.getLastUserId());
    assertEquals(
        preferencesService.getGetResponse(),
        TestHelpers.entityOf(current, UserPreferencesResponse.class));
    assertEquals(
        preferencesService.getUpdateResponse(),
        TestHelpers.entityOf(updated, UserPreferencesResponse.class));
    assertEquals("matrix", preferencesService.getLastRequestTheme());
  }

  @Test
  void shouldExposeIncompleteCanonicalUpdatesAsBadRequest() {
    var preferencesService = new ResourcePreferencesService();
    preferencesService.setRejectIncompleteCanonicalUpdates(true);
    var currentUserContext = new CurrentUserContext();
    currentUserContext.setUser(new CurrentUser("user-1", "user@example.test"));
    var resource = new AuthPreferencesResource(preferencesService, currentUserContext);

    var withRevisionOnly = assertThrows(BadRequestException.class, () -> resource.updatePreferences(
        new UpdatePreferencesRequest("matrix", null, null, null, 3L)));
    var withWorkspaceOnly = assertThrows(BadRequestException.class, () -> resource.updatePreferences(
        new UpdatePreferencesRequest("matrix", null, null, new com.sashplatonov.habbit.runner.auth.dto.UserWorkspacePreferences(), null)));

    assertEquals(400, withRevisionOnly.getResponse().getStatus());
    assertEquals(400, withWorkspaceOnly.getResponse().getStatus());
  }
}
