const { Gio, GLib, St, Clutter } = imports.gi;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Local = imports.misc.extensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(Local.metadata['gettext-domain']);
const { AltPopupBase } = Local.imports.compat;
const Playlist = Local.imports.playlist;
const Temp = Local.imports.temp;
const Helper = Local.imports.helper;
const shared = Local.imports.shared.module.exports;
const _ = Gettext.gettext;

const ICON_NAME = 'tv-symbolic';
const MIN_DELAY = 3;
const MAX_DELAY = 5;

var isUnifiedSlider = true;
var seekTime = 10;

var statusIcon = new St.Icon({ icon_name: ICON_NAME, style_class: 'system-status-icon' });

var castMenu = class CastToTvMenu extends PopupMenu.PopupMenuSection
{
	constructor()
	{
		super();
		this.extensionId = Local.metadata['extension-id'];
		this.castSubMenu = new PopupMenu.PopupSubMenuMenuItem(_("Cast Media"), true);
		this.castSubMenu.icon.icon_name = ICON_NAME;
		this.isServiceEnabled = true;

		/* Expandable menu */
		this.videoMenuItem = new PopupMenu.PopupImageMenuItem(_("Video"), 'folder-videos-symbolic');
		this.musicMenuItem = new PopupMenu.PopupImageMenuItem(_("Music"), 'folder-music-symbolic');
		this.pictureMenuItem = new PopupMenu.PopupImageMenuItem(_("Picture"), 'folder-pictures-symbolic');
		this.serviceMenuItem = new PopupMenu.PopupMenuItem(_("Turn Off"));
		this.settingsMenuItem = new PopupMenu.PopupMenuItem(_("Cast Settings"));

		/* Assemble all menu items */
		this.castSubMenu.menu.addMenuItem(this.videoMenuItem);
		this.castSubMenu.menu.addMenuItem(this.musicMenuItem);
		this.castSubMenu.menu.addMenuItem(this.pictureMenuItem);
		this.castSubMenu.menu.addMenuItem(this.serviceMenuItem);
		this.castSubMenu.menu.addMenuItem(this.settingsMenuItem);

		/* Functions */
		this.spawnFileChooser = (streamType) =>
		{
			Helper.closeOtherApps(Local.path);
			Helper.startApp(Local.path, 'file-chooser', [streamType]);
		}

		this.spawnExtensionPrefs = () =>
		{
			/* Close open window before reopening */
			GLib.spawn_command_line_async('pkill -SIGINT -f gnome-shell-extension-prefs');

			/* Open extension preferences */
			GLib.spawn_async('/usr/bin', ['gnome-shell-extension-prefs',
				'cast-to-tv@rafostar.github.com'], null, 0, null);
		}

		this.enableFullMenu = (enable) =>
		{
			let menuItems = this.castSubMenu.menu._getMenuItems();

			if(enable)
			{
				menuItems.forEach(item =>
				{
					if(item.hasOwnProperty('actor'))
						item.actor.show();
					else
						item.show();
				});
				this.serviceMenuItem.label.text = _("Turn Off");
				this.castSubMenu.label.text = _("Cast Media");
			}
			else
			{
				menuItems.forEach(item =>
				{
					if(
						item !== this.serviceMenuItem
						&& item !== this.settingsMenuItem
					) {
						if(item.hasOwnProperty('actor'))
							item.actor.hide();
						else
							item.hide();
					}
				});
				this.serviceMenuItem.label.text = _("Turn On");
				/* TRANSLATORS: When "Cast Media" service is turned off */
				this.castSubMenu.label.text = _("Cast Off");
			}

			this.isServiceEnabled = enable;
		}

		/* Signals connections */
		this.videoSignal = this.videoMenuItem.connect('activate', this.spawnFileChooser.bind(this, 'VIDEO'));
		this.musicSignal = this.musicMenuItem.connect('activate', this.spawnFileChooser.bind(this, 'MUSIC'));
		this.pictureSignal = this.pictureMenuItem.connect('activate', this.spawnFileChooser.bind(this, 'PICTURE'));
		this.settingsSignal = this.settingsMenuItem.connect('activate', this.spawnExtensionPrefs.bind(this));

		/* Add menu item */
		this.addMenuItem(this.castSubMenu);

		this.destroy = () =>
		{
			this.videoMenuItem.disconnect(this.videoSignal);
			this.musicMenuItem.disconnect(this.musicSignal);
			this.pictureMenuItem.disconnect(this.pictureSignal);
			this.settingsMenuItem.disconnect(this.settingsSignal);

			super.destroy();
		}
	}
}

var remoteMenu = class CastRemoteMenu extends PanelMenu.Button
{
	constructor()
	{
		super(0.5, "Cast to TV Remote", false);
		this.mode = 'DIRECT';

		this.box = new St.BoxLayout();
		this.icon = new St.Icon({ icon_name: 'input-dialpad-symbolic', style_class: 'system-status-icon' });
		this.toplabel = new St.Label({ y_expand: true, y_align: Clutter.ActorAlign.CENTER });

		/* Display app icon, label and dropdown arrow */
		this.box.add(this.icon);
		this.box.add(this.toplabel);
		this.box.add(PopupMenu.arrowIcon(St.Side.BOTTOM));

		if(this.hasOwnProperty('actor'))
			this.actor.add_child(this.box);
		else
			this.add_child(this.box);

		/* Create base for media control buttons */
		this.popupBase = new AltPopupBase();

		this.controlsButtonBox = new St.BoxLayout({
			x_align: Clutter.ActorAlign.CENTER,
			x_expand: true
		});

		this.trackTitle = new trackTitleItem();
		this.positionSlider = new SliderItem('folder-videos-symbolic', isUnifiedSlider, false);
		this.volumeSlider = new SliderItem('audio-volume-high-symbolic', false, true);
		this.togglePlayButton = new MediaControlButton('media-playback-pause-symbolic');
		this.stopButton = new MediaControlButton('media-playback-stop-symbolic');
		this.seekBackwardButton = new MediaControlButton('media-seek-backward-symbolic');
		this.seekForwardButton = new MediaControlButton('media-seek-forward-symbolic');
		this.skipBackwardButton = new MediaControlButton('media-skip-backward-symbolic');
		this.skipForwardButton = new MediaControlButton('media-skip-forward-symbolic');
		this.repeatButton = new MediaControlButton('media-playlist-repeat-symbolic', true);
		this.slideshowButton = new MediaControlButton('camera-photo-symbolic', true);
		this.playlist = new Playlist.CastPlaylist();

		/* Add space between stop and the remaining buttons */
		this.stopButton.style = 'padding: 0px, 6px, 0px, 6px; margin-left: 2px; margin-right: 46px;';

		/* Assemble playback controls */
		this.controlsButtonBox.add(this.slideshowButton);
		this.controlsButtonBox.add(this.repeatButton);
		this.controlsButtonBox.add(this.stopButton);
		this.controlsButtonBox.add(this.skipBackwardButton);
		this.controlsButtonBox.add(this.seekBackwardButton);
		this.controlsButtonBox.add(this.togglePlayButton);
		this.controlsButtonBox.add(this.seekForwardButton);
		this.controlsButtonBox.add(this.skipForwardButton);

		this.menu.addMenuItem(this.trackTitle);
		this.menu.addMenuItem(this.positionSlider);
		this.menu.addMenuItem(this.volumeSlider);

		if(this.popupBase.hasOwnProperty('actor'))
			this.popupBase.actor.add(this.controlsButtonBox);
		else
			this.popupBase.add(this.controlsButtonBox);

		this.menu.addMenuItem(this.popupBase);
		this.menu.addMenuItem(this.playlist.subMenu);

		/* Toggle play button stores pause state */
		this.togglePlayButton.isPause = true;

		this.sliderAction = (sliderName) =>
		{
			this[sliderName].delay = MIN_DELAY;
			let action = (this[sliderName].isVolume) ? 'VOLUME' : 'SEEK';
			Temp.setRemoteAction(action, this[sliderName].getValue());
			this[sliderName].busy = false;
		}

		this.sliderButtonAction = () =>
		{
			this.positionSlider.delay = 0;
			this.positionSlider.isVolume ^= true;

			let statusContents = Helper.readFromFile(shared.statusPath);

			if(this.positionSlider.isVolume)
			{
				this.positionSlider.setIcon(this.positionSlider.volumeIcon);
				if(statusContents) this.setVolume(statusContents);
			}
			else
			{
				this.positionSlider.setIcon(this.positionSlider.defaultIcon);
				if(statusContents) this.setProgress(statusContents);
			}
		}

		/* Signals connections */
		let connectSliderSignals = (sliderName) =>
		{
			if(this[sliderName]._slider.hasOwnProperty('actor'))
			{
				this[sliderName]._actorSignalIds.push(
					this[sliderName]._slider.actor.connect('scroll-event', () => {
						this[sliderName].delay = MAX_DELAY
					})
				);
			}
			else
			{
				this[sliderName]._signalIds.push(
					this[sliderName]._slider.connect('scroll-event', () => {
						this[sliderName].delay = MAX_DELAY
					})
				);
			}

			this[sliderName]._signalIds.push(
				this[sliderName]._slider.connect('drag-begin', () => this[sliderName].busy = true)
			);
			this[sliderName]._signalIds.push(
				this[sliderName]._slider.connect('drag-end', this.sliderAction.bind(this, sliderName))
			);

			if(isUnifiedSlider && sliderName === 'positionSlider')
			{
				this[sliderName].button._signalIds.push(
					this[sliderName].button.connect('clicked', this.sliderButtonAction.bind(this))
				);
			}
		}

		connectSliderSignals('positionSlider');
		connectSliderSignals('volumeSlider');

		this.slideshowButton._signalIds.push(
			this.slideshowButton.connect('clicked', () =>
			{
				this.repeatButton.reactive = this.slideshowButton.turnedOn;
				Temp.setRemoteAction('SLIDESHOW', this.slideshowButton.turnedOn);
			})
		);
		this.repeatButton._signalIds.push(
			this.repeatButton.connect('clicked', () =>
			{
				Temp.setRemoteAction('REPEAT', this.repeatButton.turnedOn);
			})
		);
		this.togglePlayButton._signalIds.push(
			this.togglePlayButton.connect('clicked', () =>
			{
				let toggleAction = (this.togglePlayButton.isPause) ? 'PAUSE' : 'PLAY';
				Temp.setRemoteAction(toggleAction);
			})
		);
		this.seekForwardButton._signalIds.push(
			this.seekForwardButton.connect('clicked', () => Temp.setRemoteAction('SEEK+', seekTime))
		);
		this.seekBackwardButton._signalIds.push(
			this.seekBackwardButton.connect('clicked', () => Temp.setRemoteAction('SEEK-', seekTime))
		);
		this.stopButton._signalIds.push(
			this.stopButton.connect('clicked', () => Temp.setRemoteAction('STOP'))
		);
		this.skipBackwardButton._signalIds.push(
			this.skipBackwardButton.connect('clicked', () => Temp.setRemoteAction('SKIP-'))
		);
		this.skipForwardButton._signalIds.push(
			this.skipForwardButton.connect('clicked', () => Temp.setRemoteAction('SKIP+'))
		);

		this.statusFile = Gio.file_new_for_path(shared.statusPath);
		this.statusMonitor = this.statusFile.monitor(Gio.FileMonitorFlags.NONE, null);

		let handleSliderDelay = (sliderName) =>
		{
			this[sliderName].delay--;
			if(!this[sliderName].busy && this[sliderName].delay === MIN_DELAY)
				this.sliderAction(sliderName);
		}

		this.updateRemote = (monitor, file, otherFile, event) =>
		{
			if(event !== Gio.FileMonitorEvent.CHANGES_DONE_HINT) return;

			let statusContents = Helper.readFromFile(shared.statusPath);
			if(statusContents)
			{
				if(
					statusContents.hasOwnProperty('repeat')
					&& this.repeatButton.turnedOn !== statusContents.repeat
				) {
					this.repeatButton.turnOn(statusContents.repeat);
				}

				if(
					this.mode === 'PICTURE'
					&& statusContents.hasOwnProperty('slideshow')
					&& this.slideshowButton.turnedOn !== statusContents.slideshow
				) {
					this.slideshowButton.turnOn(statusContents.slideshow);
					this.repeatButton.reactive = statusContents.slideshow;
				}

				if(this.mode === 'PICTURE') return;

				this.checkPlaying(statusContents);

				if(this.positionSlider.delay > 0)
					handleSliderDelay('positionSlider');

				if(this.volumeSlider.delay > 0)
					handleSliderDelay('volumeSlider');

				this.setVolume(statusContents);

				if(
					this.positionSlider.getVisible()
					&& !this.positionSlider.isVolume
					&& this.positionSlider.delay == 0
					&& !this.positionSlider.busy
				) {
					this.setProgress(statusContents);
				}
			}
		}

		this.monitorSignal = this.statusMonitor.connect('changed', this.updateRemote.bind(this));

		this.setPlaying = (value) =>
		{
			if(this.togglePlayButton.isPause !== value)
			{
				if(value) this.togglePlayButton.setIcon('media-playback-pause-symbolic');
				else this.togglePlayButton.setIcon('media-playback-start-symbolic');

				this.togglePlayButton.isPause = value;
			}
		}

		this.checkPlaying = (statusContents) =>
		{
			if(statusContents.playerState == 'PLAYING') this.setPlaying(true);
			else if(statusContents.playerState == 'PAUSED') this.setPlaying(false);
		}

		this.setProgress = (statusContents) =>
		{
			if(statusContents.mediaDuration > 0)
			{
				let sliderValue = statusContents.currentTime / statusContents.mediaDuration;
				this.positionSlider.setValue(sliderValue);
			}
		}

		this.setVolume = (statusContents) =>
		{
			if(statusContents.volume >= 0 && statusContents.volume <= 1)
			{
				if(
					this.volumeSlider.getVisible()
					&& this.volumeSlider.delay == 0
					&& !this.volumeSlider.busy
				) {
					this.volumeSlider.setValue(statusContents.volume);
				}
				else if(
					this.positionSlider.isVolume
					&& this.positionSlider.delay == 0
					&& !this.positionSlider.busy
				) {
					this.positionSlider.setValue(statusContents.volume);
				}
			}
		}

		this.setMode = (value, icon) =>
		{
			this.mode = value;
			let shownItems = [];

			/* Items that might be shown or hidden depending on media content */
			let changableItems = ['positionSlider', 'volumeSlider', 'togglePlayButton',
				'seekBackwardButton', 'seekForwardButton', 'repeatButton', 'slideshowButton'];

			switch(this.mode)
			{
				case 'DIRECT':
					shownItems = ['positionSlider', 'repeatButton', 'togglePlayButton',
						'seekBackwardButton', 'seekForwardButton'];
					if(!isUnifiedSlider) shownItems.push('volumeSlider');
					break;
				case 'ENCODE':
					shownItems = ['volumeSlider', 'repeatButton', 'togglePlayButton'];
					break;
				case 'PICTURE':
					shownItems = ['slideshowButton', 'repeatButton'];
					break;
				case 'LIVE':
					shownItems = ['volumeSlider', 'togglePlayButton'];
					break;
				default:
					break;
			}

			this.repeatButton.reactive = (this.mode !== 'PICTURE') ? true
				: (this.slideshowButton.turnedOn) ? true : false;

			changableItems.forEach(item =>
			{
				let isActor = (this[item].hasOwnProperty('actor'));

				if(shownItems.includes(item))
				{
					if(isActor) this[item].actor.show();
					else this[item].show();
				}
				else
				{
					if(isActor) this[item].actor.hide();
					else this[item].hide();
				}
			});

			if(icon) this.positionSlider.defaultIcon = icon;

			Playlist.seekAllowed = (this.mode === 'DIRECT') ? true : false;
		}

		this.setMediaButtonsSize = (size) =>
		{
			this.togglePlayButton.child.icon_size = size;
			this.stopButton.child.icon_size = size;
			this.seekBackwardButton.child.icon_size = size;
			this.seekForwardButton.child.icon_size = size;
			this.skipBackwardButton.child.icon_size = size;
			this.skipForwardButton.child.icon_size = size;
			this.repeatButton.child.icon_size = size;
			this.slideshowButton.child.icon_size = size;
		}

		this.setSlidersIconSize = (size) =>
		{
			this.positionSlider.setIconSize(size);
			this.volumeSlider.setIconSize(size);
		}

		this.destroy = () =>
		{
			this.statusMonitor.disconnect(this.monitorSignal);
			this.statusMonitor.cancel();
			this.playlist.destroy();

			super.destroy();
		}
	}
}

class MediaControlButton extends St.Button
{
	constructor(icon, toggle, size)
	{
		if(!size) size = 20;

		super({
			style: 'padding: 4px, 6px, 4px, 6px; margin-left: 2px; margin-right: 2px;',
			opacity: 130,
			child: new St.Icon({ style_class: 'popup-menu-icon', icon_size: size, icon_name: icon })
		});

		this.turnedOn = false;

		let callback = () =>
		{
			this.opacity = (!this.reactive) ? 30 :
				(this.turnedOn || this.hover) ? 255 : 130;
		}

		let changeState = () =>
		{
			if(toggle)
			{
				this.turnedOn = !this.turnedOn;
				if(this.turnedOn) this.opacity = 255;
				else this.opacity = 130;
			}
		}

		this._signalIds = [
			this.connect('notify::hover', callback),
			this.connect('notify::reactive', callback),
			this.connect('clicked', changeState),
			this.connect('destroy', () => {
				this._signalIds.forEach(signalId => this.disconnect(signalId));
				this.turnedOn = null;
			})
		];

		/* Functions */
		this.turnOn = (value) =>
		{
			if(value) this.opacity = 255;
			else this.opacity = 130;

			this.turnedOn = value;
		}

		this.setIcon = (iconName) =>
		{
			this.child.icon_name = iconName;
		}
	}
}

class SliderItem extends AltPopupBase
{
	constructor(icon, toggle, isVolume)
	{
		super();
		this.defaultIcon = icon;
		this.volumeIcon = 'audio-volume-high-symbolic';
		this._toggle = toggle;
		this._slider = new Slider.Slider(0);

		this.button = (this._toggle) ?
			new MediaControlButton(this.defaultIcon, false, 16) :
			new St.Icon({ style_class: 'popup-menu-icon', icon_size: 16, icon_name: icon });

		this.delay = 0;
		this.busy = false;
		this.isVolume = isVolume || false;

		if(this.hasOwnProperty('actor'))
		{
			this.actor.add(this.button);
			this.actor.add(this._slider.actor, { expand: true });
			this.actor.visible = true;
		}
		else
		{
			this.add(this.button);
			this.add(this._slider, { expand: true });
			this.visible = true;
		}

		this.button.style = 'margin-right: 2px;';

		/* Actor signals for backward compatibility */
		this._actorSignalIds = [];

		/* Slider signals */
		this._signalIds = [];

		this.destroySignal = this.connect('destroy', () => {
			this.disconnect(this.destroySignal);
			this._signalIds.forEach(signalId => this._slider.disconnect(signalId));
			this._actorSignalIds.forEach(signalId => {
				if(this._slider.hasOwnProperty('actor'))
					this._slider.actor.disconnect(signalId);
			});
			this.turnedOn = null;
		});

		/* Functions */
		this.getVisible = () =>
		{
			if(this.hasOwnProperty('actor'))
				return this.actor.visible;
			else
				return this.visible;
		}

		this.setIconSize = (size) =>
		{
			if(this._toggle) this.button.child.icon_size = size;
			else this.button.icon_size = size;
		}

		this.getValue = () =>
		{
			return this._slider.value.toFixed(3);
		}

		this.setValue = (value) =>
		{
			if(this._slider.setValue && typeof this._slider.setValue === 'function')
				this._slider.setValue(value);
			else
				this._slider.value = value;
		}

		this.setIcon = (iconName) =>
		{
			if(this._toggle) this.button.child.icon_name = iconName;
			else this.button.icon_name = iconName;
		}
	}
}

class trackTitleItem extends AltPopupBase
{
	constructor()
	{
		super();
		this._title = new St.Label({ text: "", x_align: Clutter.ActorAlign.CENTER, x_expand: true });

		if(this.hasOwnProperty('actor'))
			this.actor.add(this._title);
		else
			this.add(this._title);

		/* Functions */
		this.setText = (text) => this._title.text = text;
	}
}
